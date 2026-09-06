import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
const runtimeRoot = resolve(import.meta.dirname, ".."),
  repositoryRoot = resolve(runtimeRoot, "../.."),
  harnessPath = resolve(
    runtimeRoot,
    "test/fixtures/object-db-executable-parity-wave8-harness.mjs",
  ),
  targetPath = resolve(
    runtimeRoot,
    "test/fixtures/object-db-executable-parity-wave8-admin-chain.mjs",
  ),
  fixturePath = resolve(
    repositoryRoot,
    "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave8-admin-chain-v1.json",
  ),
  fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const hash = (path: string) =>
  createHash("sha256")
    .update(readFileSync(path, "utf8").replace(/\r\n?/g, "\n"))
    .digest("hex");
function run(binding: any, payload = fixture.payload) {
  const dir = mkdtempSync(join(tmpdir(), "hoibot-wave8-")),
    input = join(dir, "input.json");
  writeFileSync(
    input,
    JSON.stringify({
      binding,
      fixturePayload: payload,
      invocation: {
        targetPath:
          "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave8-admin-chain.mjs",
        targetSourceSha256: hash(targetPath),
        exportName: "executeWave8AdminChain",
      },
    }),
  );
  let error: unknown = null;
  try {
    execFileSync(process.execPath, [harnessPath, input, dir, targetPath], {
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (caught) {
    error = caught;
  }
  return { dir, error };
}
const consumerFor = (id: string) =>
  fixture.payload.cases
    .flatMap((entry: any) => entry.consumers)
    .find((entry: any) => entry.consumerId === id);
describe("object DB executable parity Wave8 admin chain", () => {
  it("executes all four admin consumers through their actual service chains", () => {
    assert.equal(fixture.bindings.length, 24);
    assert.equal(fixture.payload.riskBindings.length, 11);
    for (const binding of [
      ...fixture.bindings,
      ...fixture.payload.riskBindings,
    ]) {
      const result = run(binding);
      try {
        assert.equal(result.error, null);
        const trace = JSON.parse(
            readFileSync(join(result.dir, "trace.json"), "utf8"),
          ),
          consumer = consumerFor(binding.consumerId),
          repetitions = binding.scenarioKind === "RESTART_CONSISTENCY" ? 2 : 1,
          queries = consumer.queryPlanByScenario[binding.scenarioKind],
          mutations = consumer.mutationPlanByScenario[binding.scenarioKind];
        assert.equal(trace.queryTrace.length, queries.length * repetitions);
        assert.equal(trace.dmlTrace.length, mutations.length * repetitions);
        const expectedLocks: string[] = [];
        for (const query of queries) {
          if (!/\bFOR UPDATE\b/i.test(query.expectedNormalizedSql)) continue;
          for (const match of query.expectedNormalizedSql.matchAll(
            /\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi,
          ))
            if (!expectedLocks.includes(match[1])) expectedLocks.push(match[1]);
        }
        assert.deepEqual(trace.lockOrder, expectedLocks);
        const expectedTimeline =
          binding.scenarioKind === "RESTART_CONSISTENCY"
            ? ["CHILD_PROCESS_1:COMMIT", "RESTART", "CHILD_PROCESS_2:COMMIT"]
            : binding.scenarioKind === "ROLLBACK"
              ? ["BEGIN", "ROLLBACK"]
              : binding.scenarioKind.endsWith("RETRY_SUCCESS")
                ? ["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]
                : binding.scenarioKind.endsWith("RETRY_EXHAUSTED")
                  ? ["BEGIN", "ROLLBACK", "BEGIN", "ROLLBACK", "BEGIN", "ROLLBACK"]
                  : ["READ_POSITIVE", "EXACT_OUTPUT"].includes(binding.scenarioKind)
                    ? ["BEGIN", "COMMIT"]
                    : binding.scenarioKind === "NEGATIVE_GUARD"
                      ? ["GUARD_REJECTED"]
                      : trace.timeline;
        assert.deepEqual(trace.timeline, expectedTimeline);
        if (binding.scenarioKind.endsWith("RETRY_SUCCESS")) {
          assert.equal(trace.transaction, "COMMIT");
          assert.deepEqual(
            trace.transactionAttempts.map((attempt: any) => ({
              outcome: attempt.outcome,
              committed: attempt.committed,
            })),
            [
              { outcome: "ROLLBACK", committed: false },
              { outcome: "COMMIT", committed: true },
            ],
          );
        }
        if (binding.scenarioKind === "NEGATIVE_GUARD") {
          assert.deepEqual(trace.queryTrace, []);
          assert.deepEqual(trace.dmlTrace, []);
          assert.equal(trace.transaction, "READ_ONLY");
        }
        if (binding.scenarioKind === "ROLLBACK")
          assert.equal(trace.transaction, "ROLLBACK");
        if (binding.scenarioKind.endsWith("RETRY_EXHAUSTED")) {
          assert.equal(trace.transaction, "ROLLBACK");
          assert.deepEqual(
            trace.normalizedStatements,
            mutations.map((entry: any) => entry.expectedNormalizedSql),
          );
          assert.deepEqual(
            trace.transactionAttempts.map((attempt: any) => ({
              outcome: attempt.outcome,
              committed: attempt.committed,
            })),
            Array.from({ length: 3 }, () => ({
              outcome: "ROLLBACK",
              committed: false,
            })),
          );
          if (binding.scenarioKind.startsWith("DUPLICATE")) {
            assert.equal(trace.transactionAttempts.length, 3);
            for (const attempt of trace.transactionAttempts) {
              assert.equal(attempt.dmlStatements.length, 1);
              assert.match(attempt.dmlStatements[0], /^INSERT INTO operations/);
              assert.equal(attempt.dmlRowCount, 1);
            }
          } else
            assert.equal(
              trace.normalizedStatements.filter(
                (sql: string) =>
                  !sql.startsWith("INSERT INTO command_routing_decisions"),
              ).length,
              0,
            );
        }
        if (binding.scenarioKind === "DUPLICATE_RETRY_SUCCESS") {
          assert.deepEqual(
            trace.transactionAttempts[0].dmlStatements.map((sql: string) =>
              sql.match(/^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i)?.[1],
            ),
            ["operations"],
          );
          assert.equal(trace.transactionAttempts[0].committed, false);
          assert.ok(trace.transactionAttempts[1].dmlStatements.length > 1);
          assert.equal(trace.transactionAttempts[1].committed, true);
        }
        if (binding.scenarioKind === "RESTART_CONSISTENCY") {
          const raw = JSON.parse(
            readFileSync(join(result.dir, "result.raw"), "utf8"),
          );
          assert.equal(raw.restartEvidence.distinctProcessIds, true);
          assert.equal(raw.restartEvidence.distinctModuleExecutions, true);
          const keys = trace.dmlTrace
            .filter((entry: any) =>
              entry.normalizedSql.startsWith("INSERT INTO operations"),
            )
            .map((entry: any) => entry.values[0]);
          assert.equal(keys.length, 2);
          for (const key of keys)
            assert.match(
              key,
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
          assert.notEqual(keys[0], keys[1]);
          assert.equal(raw.restartEvidence.distinctOperationKeys, true);
        }
      } finally {
        rmSync(result.dir, { recursive: true, force: true });
      }
    }
  });
  it("fails closed on SQL, parameter, row, result and chain drift", () => {
    for (const original of fixture.payload.cases.map(
      (entry: any) => entry.consumers[0],
    ))
      for (const mutate of [
        (value: any) => (value.chainLocators[0].sha256 = "0".repeat(64)),
        (value: any) =>
          (value.queryPlanByScenario.READ_POSITIVE[0].expectedNormalizedSql +=
            " FOR UPDATE"),
        (value: any) =>
          (value.queryPlanByScenario.READ_POSITIVE[0].expectedValues = [
            "drift",
          ]),
        (value: any) => (value.queryPlanByScenario.READ_POSITIVE[0].rows = []),
        (value: any) => (value.expectedResultsByScenario.READ_POSITIVE = "{}"),
      ]) {
        const payload = structuredClone(fixture.payload),
          changed = payload.cases
            .flatMap((entry: any) => entry.consumers)
            .find((entry: any) => entry.consumerId === original.consumerId);
        mutate(changed);
        const binding = fixture.bindings.find(
          (entry: any) =>
            entry.consumerId === original.consumerId &&
            entry.scenarioKind === "READ_POSITIVE",
        );
        assert.ok(binding);
        const result = run(binding, payload);
        try {
          assert.ok(result.error);
        } finally {
          rmSync(result.dir, { recursive: true, force: true });
        }
      }
  });
});
