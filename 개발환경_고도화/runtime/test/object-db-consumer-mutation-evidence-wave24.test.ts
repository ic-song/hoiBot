import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { validateObjectDbMutationScenarioEvidence, type ObjectDbMutationEvidenceContract, type ObjectDbMutationScenarioEvidence } from "../src/data-migration/object-db-consumer-mutation-evidence.js";

const root = resolve(import.meta.dirname, "../..");
const fixture = JSON.parse(readFileSync(resolve(root, "migration-control/contracts/object-db-consumer-executable-parity-wave24-mutations-v1.json"), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("Wave24 bundled schema, six sealed scenarios, and actual Shadow observation pass", () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(resolve(root, "migration-control/contracts/object-db-consumer-mutation-evidence-wave24.v1.schema.json"), "utf8")));
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.deepEqual(fixture.consumerIds, ["sql-repository-87ed81931dd7417b"]);
  assert.equal(fixture.cases.length, 1);
  assert.deepEqual({route:fixture.shadowObservation.route,outcome:fixture.shadowObservation.transactionOutcome,committed:fixture.shadowObservation.committedRowCount,before:fixture.shadowObservation.beforeSha256,after:fixture.shadowObservation.afterSha256},{route:"SHADOW",outcome:"ROLLBACK",committed:0,before:fixture.shadowObservation.afterSha256,after:fixture.shadowObservation.beforeSha256});
  for (const candidate of fixture.cases) {
    assert.equal(candidate.bindings.length, 6);
    assert.equal(candidate.sealedObservations.length, 6);
    assert.equal(candidate.mutationContract.scenarios.length, 6);
    assert.equal(new Set(candidate.bindings.map((binding: { scenarioKind: string }) => binding.scenarioKind)).size, 6);
    for (const evidence of candidate.sealedObservations) validateObjectDbMutationScenarioEvidence(candidate.mutationContract as ObjectDbMutationEvidenceContract, evidence);
  }
});

test("Wave24 restart and concurrency use distinct child processes", () => {
  for (const candidate of fixture.cases) for (const kind of ["RESTART_REPLAY", "CONCURRENCY_SINGLE_WRITER"]) {
    const evidence = candidate.sealedObservations.find((item: { scenarioKind: string }) => item.scenarioKind === kind);
    assert.ok(evidence);
    assert.equal(evidence.traces.length, 2);
    assert.notEqual(evidence.traces[0].processId, evidence.traces[1].processId);
    assert.notEqual(evidence.traces[0].moduleExecutionId, evidence.traces[1].moduleExecutionId);
  }
});

test("Wave24 rejects table, locator, row hash, attempt failure, process, and Shadow tampering", () => {
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
  const schema = new (createRequire(import.meta.url)("ajv/dist/2020").default)({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(resolve(root, "migration-control/contracts/object-db-consumer-mutation-evidence-wave24.v1.schema.json"), "utf8")));
  for(const mutate of [(value:any)=>{value.shadowObservation.committedRowCount=1;},(value:any)=>{value.shadowObservation.afterSha256="0".repeat(64);},(value:any)=>{value.shadowContract.route="MODERN";}]){const value=clone(fixture);mutate(value);assert.equal(schema(value),false);}
});
