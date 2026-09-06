import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { assertTrustedWave6ConsumerFixtureMapping } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(runtimeRoot, "../..");
const harnessPath = resolve(runtimeRoot, "test/fixtures/object-db-executable-parity-harness.mjs");
const targetPath = resolve(runtimeRoot, "test/fixtures/object-db-executable-parity-wave6-multi-query.mjs");
const fixturePath = resolve(repositoryRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave6-multi-query-v1.json");
const readJson = (path: string): any => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const manifest = readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const consumerIds = ["sql-repository-3001ad9fc2f36d01", "sql-repository-7367fce7053551f3"];

function consumerFor(consumerId: string): any {
  return fixture.payload.cases.flatMap((parityCase: any) => parityCase.consumers).find((consumer: any) => consumer.consumerId === consumerId);
}

function sha256Text(path: string): string {
  return createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n?/g, "\n")).digest("hex");
}

function runBinding(binding: any, fixturePayload = fixture.payload): { outputDirectory: string; error: unknown } {
  const outputDirectory = mkdtempSync(join(tmpdir(), "hoibot-wave6-parity-"));
  const inputPath = join(outputDirectory, "input.json");
  const exportName = binding.consumerId === "sql-repository-7367fce7053551f3" ? "executeWave6ResolveSelf" : "executeWave6BagCompare";
  writeFileSync(inputPath, JSON.stringify({
    binding,
    fixturePayload,
    invocation: {
      targetPath: "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave6-multi-query.mjs",
      targetSourceSha256: sha256Text(targetPath),
      exportName,
    },
  }));
  let error: unknown = null;
  try {
    execFileSync(process.execPath, [harnessPath, inputPath, outputDirectory, targetPath], { stdio: "pipe", timeout: 20_000 });
  } catch (caught) {
    error = caught;
  }
  return { outputDirectory, error };
}

describe("object DB executable parity Wave6 ordered multi-query cohort", () => {
  it("promotes both remaining SQL repository consumers with five direct receipts each", () => {
    const ledger = readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
    const receipts = readJson("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave6-v1.json");
    assert.equal(ledger.coverage.manifestConsumers, 1111);
    assert.equal(ledger.coverage.ledgerEntries, 1111);
    assert.ok(ledger.coverage.provenConsumers >= 18);
    assert.equal(ledger.coverage.unprovenConsumers, ledger.coverage.manifestConsumers - ledger.coverage.provenConsumers);
    assert.ok(ledger.coverage.directPassConsumers >= 18);
    assert.equal(ledger.coverage.registrySourceMismatchCount, 8);
    assert.equal(receipts.receipts.length, 55);
    for (const consumerId of consumerIds) {
      assert.equal(receipts.receipts.filter((receipt: any) => receipt.consumerId === consumerId).length, 5);
      assert.equal(ledger.entries.find((entry: any) => entry.consumerId === consumerId)?.verdict, "DIRECT_PASS");
      const source = manifest.consumers.find((candidate: any) => candidate.consumerId === consumerId);
      assert.doesNotThrow(() => assertTrustedWave6ConsumerFixtureMapping(consumerId, consumerFor(consumerId), source));
    }
  });

  it("executes exact query count, order, SQL, parameters, rows and READ_ONLY traces in fresh children", () => {
    for (const binding of fixture.bindings) {
      const run = runBinding(binding);
      try {
        assert.equal(run.error, null);
        const caseResult = JSON.parse(readFileSync(join(run.outputDirectory, "case-result.json"), "utf8"));
        const trace = JSON.parse(readFileSync(join(run.outputDirectory, "trace.json"), "utf8"));
        const consumer = consumerFor(binding.consumerId);
        const scenarioRows = consumer.queryRowsByScenario[binding.scenarioKind] ?? [];
        const repetitions = binding.scenarioKind === "RESTART_CONSISTENCY" ? 2 : 1;
        const expectedTrace = Array.from({ length: repetitions }, () => scenarioRows.map((rows: any[], index: number) => ({
          channel: "query",
          normalizedSql: consumer.orderedQueries[index].expectedNormalizedSql,
          values: consumer.orderedQueries[index].expectedQueryValues,
          rowCount: rows.length,
        }))).flat();
        assert.equal(caseResult.passed, true);
        assert.equal(caseResult.executedConsumerId, binding.consumerId);
        assert.equal(caseResult.scenarioKind, binding.scenarioKind);
        assert.deepEqual(trace.queryTrace, expectedTrace);
        assert.deepEqual(trace.normalizedStatements, []);
        assert.equal(trace.rowCount, 0);
        assert.deepEqual(trace.lockOrder, []);
        assert.equal(trace.transaction, "READ_ONLY");
        if (binding.scenarioKind === "NEGATIVE_GUARD") assert.deepEqual(trace.timeline, ["GUARD_REJECTED"]);
        if (binding.scenarioKind === "RESTART_CONSISTENCY") {
          const result = JSON.parse(readFileSync(join(run.outputDirectory, "result.raw"), "utf8"));
          assert.deepEqual(result.restartEvidence, { processExecutions: 2, distinctProcessIds: true, distinctModuleExecutions: true });
        }
      } finally {
        rmSync(run.outputDirectory, { recursive: true, force: true });
      }
    }
  });

  it("fails closed on locator, input, query order, SQL, parameters, row and result drift", () => {
    for (const consumerId of consumerIds) {
      const original = consumerFor(consumerId);
      const source = manifest.consumers.find((candidate: any) => candidate.consumerId === consumerId);
      for (const mutate of [
        (value: any) => { value.sourceLocator.symbol = "other"; },
        (value: any) => { value.input.externalUserId = "user-2"; },
        (value: any) => { value.orderedQueries.reverse(); },
        (value: any) => { value.orderedQueries[0].expectedNormalizedSql += " AND 1=0"; },
        (value: any) => { value.orderedQueries[0].expectedQueryValues[0] = "other"; },
        (value: any) => { value.queryRowsByScenario.READ_POSITIVE[0][0].displayName = "변조"; },
        (value: any) => { value.expectedResultsByScenario.READ_POSITIVE = null; },
      ]) {
        const changed = structuredClone(original);
        mutate(changed);
        assert.throws(() => assertTrustedWave6ConsumerFixtureMapping(consumerId, changed, source), /drift/);
      }
    }

    for (const consumerId of consumerIds) {
      const payload = structuredClone(fixture.payload);
      const changed = payload.cases.flatMap((parityCase: any) => parityCase.consumers).find((consumer: any) => consumer.consumerId === consumerId);
      changed.orderedQueries.reverse();
      const binding = fixture.bindings.find((candidate: any) => candidate.consumerId === consumerId && candidate.scenarioKind === "READ_POSITIVE");
      const run = runBinding(binding, payload);
      try {
        assert.ok(run.error);
        const stderr = (run.error as { stderr?: Buffer }).stderr?.toString("utf8") ?? String(run.error);
        assert.match(stderr, /ordered SELECT (SQL|count) drift/);
      } finally {
        rmSync(run.outputDirectory, { recursive: true, force: true });
      }
    }
  });
});
