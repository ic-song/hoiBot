import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { validateObjectDbMutationScenarioEvidence, type ObjectDbMutationEvidenceContract, type ObjectDbMutationScenarioEvidence } from "../src/data-migration/object-db-consumer-mutation-evidence.js";

const root = resolve(import.meta.dirname, "../..");
const fixture = JSON.parse(readFileSync(resolve(root, "migration-control/contracts/object-db-consumer-executable-parity-wave23-mutations-v1.json"), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("Wave23 bundled schema and 18 sealed scenarios pass", () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(resolve(root, "migration-control/contracts/object-db-consumer-mutation-evidence-wave23.v1.schema.json"), "utf8")));
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.deepEqual(fixture.consumerIds, ["sql-repository-31c4099080d9c9c1", "sql-repository-818137c4fb22037a", "sql-repository-f6c531148a436a21"]);
  assert.equal(fixture.cases.length, 3);
  for (const candidate of fixture.cases) {
    assert.equal(candidate.bindings.length, 6);
    assert.equal(candidate.sealedObservations.length, 6);
    assert.equal(candidate.mutationContract.scenarios.length, 6);
    assert.equal(new Set(candidate.bindings.map((binding: { scenarioKind: string }) => binding.scenarioKind)).size, 6);
    for (const evidence of candidate.sealedObservations) validateObjectDbMutationScenarioEvidence(candidate.mutationContract as ObjectDbMutationEvidenceContract, evidence);
  }
});

test("Wave23 restart and concurrency use distinct child processes", () => {
  for (const candidate of fixture.cases) for (const kind of ["RESTART_REPLAY", "CONCURRENCY_SINGLE_WRITER"]) {
    const evidence = candidate.sealedObservations.find((item: { scenarioKind: string }) => item.scenarioKind === kind);
    assert.ok(evidence);
    assert.equal(evidence.traces.length, 2);
    assert.notEqual(evidence.traces[0].processId, evidence.traces[1].processId);
    assert.notEqual(evidence.traces[0].moduleExecutionId, evidence.traces[1].moduleExecutionId);
  }
});

test("Wave23 rejects table, locator, row hash, attempt failure and process tampering", () => {
  for (const candidate of fixture.cases) {
    const contract = candidate.mutationContract as ObjectDbMutationEvidenceContract;
    const success = candidate.sealedObservations.find((item: { scenarioKind: string }) => item.scenarioKind === "MUTATION_SUCCESS") as ObjectDbMutationScenarioEvidence;
    const failure = candidate.sealedObservations.find((item: { scenarioKind: string }) => item.scenarioKind === "DOMAIN_FAILURE_ROLLBACK") as ObjectDbMutationScenarioEvidence;
    const restart = candidate.sealedObservations.find((item: { scenarioKind: string }) => item.scenarioKind === "RESTART_REPLAY") as ObjectDbMutationScenarioEvidence;
    const attacks: Array<[ObjectDbMutationScenarioEvidence, (value: ObjectDbMutationScenarioEvidence) => void]> = [
      [success, (value) => { value.traces[0]!.transactionAttempts[0]!.attemptedDmlStatements.push("INSERT INTO forbidden_table VALUES (?)"); }],
      [success, (value) => { value.traces[0]!.locatorProjection!.locatorOK = false as true; }],
      [success, (value) => { value.traces[0]!.afterSha256 = "0".repeat(64); }],
      [failure, (value) => { value.traces[0]!.transactionAttempts[0]!.failure = { code: "TAMPER", errno: 999, errorKind: "OTHER", constraintName: null }; }],
      [restart, (value) => { value.traces[1]!.processId = value.traces[0]!.processId; }],
    ];
    for (const [baseline, mutate] of attacks) { const value = clone(baseline); mutate(value); assert.throws(() => validateObjectDbMutationScenarioEvidence(contract, value)); }
  }
});
