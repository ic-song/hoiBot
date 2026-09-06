import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { PlayerCumulativeLevelRankReadService } from "../src/player/player-cumulative-level-rank-read-service.js";
import { PlayerCumulativeLikeRankReadService } from "../src/player/player-cumulative-like-rank-read-service.js";
import { PlayerOverallRankReadService } from "../src/player/player-overall-rank-read-service.js";
import { HomeRankingReadService } from "../src/home/home-ranking-read-service.js";
import { HomeFurnitureRankReadService } from "../src/home/home-furniture-rank-read-service.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(runtimeRoot, "../..");
const harnessPath = resolve(runtimeRoot, "test/fixtures/object-db-executable-parity-wave9-harness.mjs");
const targetPath = resolve(runtimeRoot, "test/fixtures/object-db-executable-parity-wave9-rank-chain.mjs");
const fixturePath = resolve(repositoryRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave9-rank-chain-v1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n?/g, "\n")).digest("hex");
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
function run(binding: any, payload = fixture.payload) {
  const dir = mkdtempSync(join(tmpdir(), "hoibot-wave9-"));
  const input = join(dir, "input.json");
  writeFileSync(input, JSON.stringify({ binding, fixturePayload: payload, invocation: { targetPath: "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave9-rank-chain.mjs", targetSourceSha256: hash(targetPath), exportName: "executeWave9RankChain" } }));
  let error: unknown = null;
  try { execFileSync(process.execPath, [harnessPath, input, dir, targetPath], { stdio: "pipe", timeout: 30_000 }); } catch (caught) { error = caught; }
  return { dir, error };
}
const allConsumers = () => fixture.payload.cases.flatMap((entry: any) => entry.consumers);
const table = (sql: string) => sql.match(/^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i)?.[1];
const ALLOWED_DML = new Set(["operations", "outbox_messages", "command_executions", "command_audit"]);

describe("object DB executable parity Wave9 rank chain", () => {
  it("executes 25 receipts and rollback/replay risks through exact production services", () => {
    assert.equal(fixture.bindings.length, 25);
    assert.equal(fixture.payload.riskBindings.length, 10);
    for (const binding of [...fixture.bindings, ...fixture.payload.riskBindings]) {
      const result = run(binding);
      try {
        assert.equal(result.error, null);
        const trace = JSON.parse(readFileSync(join(result.dir, "trace.json"), "utf8"));
        if (binding.scenarioKind === "NEGATIVE_GUARD") {
          assert.deepEqual(trace.queryTrace, []);
          assert.deepEqual(trace.dmlTrace, []);
          assert.deepEqual(trace.timeline, ["GUARD_REJECTED"]);
          continue;
        }
        assert.ok(trace.queryTrace.length >= 2);
        if (binding.scenarioKind === "SAME_EVENT_REPLAY") {
          assert.equal(trace.transaction, "COMMIT");
          assert.deepEqual(trace.dmlTrace, []);
          assert.deepEqual(trace.timeline, ["BEGIN", "COMMIT"]);
          continue;
        }
        if (binding.scenarioKind === "ROLLBACK") {
          assert.equal(trace.transaction, "ROLLBACK");
          assert.deepEqual(trace.timeline, ["BEGIN", "ROLLBACK"]);
          assert.equal(trace.dmlTrace.length, 3);
          assert.equal(table(trace.dmlTrace[2].normalizedSql), "command_executions");
          continue;
        }
        const repetitions = binding.scenarioKind === "RESTART_CONSISTENCY" ? 2 : 1;
        assert.equal(trace.dmlTrace.length, 5 * repetitions);
        assert.ok(trace.dmlTrace.every((entry: any) => ALLOWED_DML.has(table(entry.normalizedSql)!)));
        assert.deepEqual(trace.timeline, binding.scenarioKind === "RESTART_CONSISTENCY" ? ["CHILD_PROCESS_1:COMMIT", "RESTART", "CHILD_PROCESS_2:COMMIT"] : ["BEGIN", "COMMIT"]);
        assert.ok(trace.lockOrder.includes("operations"));
        if (binding.scenarioKind === "RESTART_CONSISTENCY") {
          const raw = JSON.parse(readFileSync(join(result.dir, "result.raw"), "utf8"));
          assert.equal(raw.restartEvidence.distinctProcessIds, true);
          assert.equal(raw.restartEvidence.distinctModuleExecutions, true);
          assert.equal(raw.restartEvidence.distinctOperationKeys, true);
          const keys = trace.dmlTrace.filter((entry: any) => entry.normalizedSql.startsWith("INSERT INTO operations")).map((entry: any) => entry.values[0]);
          assert.equal(keys.length, 2);
          assert.notEqual(keys[0], keys[1]);
          for (const key of keys) assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        }
      } finally { rmSync(result.dir, { recursive: true, force: true }); }
    }
  });

  it("serializes concurrent same-event calls to one writer and one replay", async () => {
    const classes: Record<string, any> = {
      "runtime-dispatch-465e4b3a15c003dc": PlayerCumulativeLevelRankReadService,
      "runtime-dispatch-9db5e3e6c256b5fa": PlayerCumulativeLikeRankReadService,
      "runtime-dispatch-eaa906ea249408a5": PlayerOverallRankReadService,
      "runtime-dispatch-e02f58bf27070ab0": HomeRankingReadService,
      "runtime-dispatch-e54fc7fbded287c6": HomeFurnitureRankReadService,
    };
    for (const consumer of allConsumers()) {
      const servicePlan = consumer.queryPlanByScenario.READ_POSITIVE.slice(1);
      let stored: any = null, writes = 0, queue = Promise.resolve();
      const db: any = {
        withTransaction(work: any) {
          const runLocked = async () => {
            let queryIndex = 0;
            const transaction = {
              query: async (sql: string) => {
                const normalized = normalize(sql);
                if (normalized.startsWith("SELECT result_json FROM operations")) return stored === null ? [] : [{ result_json: stored }];
                const step = servicePlan.find((entry: any, index: number) => index >= queryIndex && entry.expectedNormalizedSql === normalized);
                assert.ok(step, `${consumer.consumerId}: concurrent query drift`);
                queryIndex = servicePlan.indexOf(step) + 1;
                const revive = (value: any): any => Array.isArray(value) ? value.map(revive) : value && typeof value === "object" ? Object.keys(value).length === 1 && typeof value.$bigint === "string" ? BigInt(value.$bigint) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)])) : value;
                return revive(step.rows);
              },
              execute: async (sql: string, values: any[]) => {
                const normalized = normalize(sql);
                writes += 1;
                if (normalized.startsWith("UPDATE operations SET status='completed'")) stored = JSON.parse(values[0]);
                return { affectedRows: 1n, insertId: normalized.startsWith("INSERT INTO operations") ? 501n : normalized.startsWith("INSERT INTO outbox_messages") ? 601n : 1n };
              },
            };
            return work(transaction);
          };
          const result = queue.then(runLocked, runLocked);
          queue = result.then(() => undefined, () => undefined);
          return result;
        },
      };
      const Service = classes[consumer.consumerId];
      const service = new Service(db);
      const input = { ...consumer.scenarioInputsByScenario.READ_POSITIVE, eventId: `wave9-concurrent-${consumer.consumerId}` };
      const [first, second] = await Promise.all([service.read(input), service.read(input)]);
      assert.deepEqual(second, first);
      assert.equal(writes, 5);
    }
  });

  it("fails closed on app span, SQL, parameters, rows and output drift", () => {
    for (const original of allConsumers()) for (const mutate of [
      (value: any) => value.sourceLocator.sha256 = "0".repeat(64),
      (value: any) => value.queryPlanByScenario.READ_POSITIVE[0].expectedNormalizedSql += " FOR UPDATE",
      (value: any) => value.queryPlanByScenario.READ_POSITIVE[0].expectedValues = ["drift"],
      (value: any) => value.queryPlanByScenario.READ_POSITIVE[1].rows = [{ result_json: { drift: true } }],
      (value: any) => value.expectedResultsByScenario.READ_POSITIVE = "{}",
    ]) {
      const payload = structuredClone(fixture.payload);
      const changed = payload.cases.flatMap((entry: any) => entry.consumers).find((entry: any) => entry.consumerId === original.consumerId);
      mutate(changed);
      const binding = fixture.bindings.find((entry: any) => entry.consumerId === original.consumerId && entry.scenarioKind === "READ_POSITIVE");
      const result = run(binding, payload);
      try { assert.ok(result.error); } finally { rmSync(result.dir, { recursive: true, force: true }); }
    }
  });
});
