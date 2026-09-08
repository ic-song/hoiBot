import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { deriveUniqueClassMethodSourceSpan } from "../src/data-migration/object-db-consumer-transition-audit.js";

interface Trace {
  processId: number;
  role: string;
  scenario: string;
  attempts: Array<{ outcome: string; lockOrder: string[]; failure: { code: string | null; errno: number | null; errorKind: string; constraintName: string | null } | null }>;
  committedDml: string[];
  committedRows: number;
  rolledBackAffectedRows: number;
  replayed: boolean | null;
  errorCode: string | null;
  beforeSha256: string;
  afterSha256: string;
  locatorProjection: { mode: string; rows: unknown[]; locatorOK: boolean };
  externalNetworkCalls: number;
  replyCalls: number;
}

const runtimeRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(runtimeRoot, "../..");
const fixturePath = resolve(runtimeRoot, "test/fixtures/canonical-furniture-place-targeted.mjs");
const evidencePath = resolve(repositoryRoot, "개발환경_고도화/migration-control/evidence/wbs787-furniture-place/targeted-evidence.json");
const temporaryRoot = mkdtempSync(join(tmpdir(), "wbs787-furniture-place-"));

function run(request: Record<string, unknown>, name: string): Trace {
  const inputPath = join(temporaryRoot, `${name}.input.json`);
  const outputPath = join(temporaryRoot, `${name}.output.json`);
  writeFileSync(inputPath, JSON.stringify(request), "utf8");
  execFileSync(process.execPath, ["--import", "tsx", fixturePath, inputPath, outputPath], { cwd: runtimeRoot, stdio: "pipe", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(readFileSync(outputPath, "utf8")) as Trace;
}

async function runConcurrent(request: Record<string, unknown>, name: string): Promise<Trace> {
  const inputPath = join(temporaryRoot, `${name}.input.json`);
  const outputPath = join(temporaryRoot, `${name}.output.json`);
  writeFileSync(inputPath, JSON.stringify(request), "utf8");
  await new Promise<void>((accept, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fixturePath, inputPath, outputPath], { cwd: runtimeRoot, stdio: "pipe" });
    let errorText = "";
    child.stderr.on("data", (value) => { errorText += String(value); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? accept() : reject(new Error(`WBS787 child failed (${code}): ${errorText}`)));
  });
  return JSON.parse(readFileSync(outputPath, "utf8")) as Trace;
}

function reset(name: string): void { run({ mode: "RESET" }, `${name}-reset`); }
function assertNoExternalEffects(trace: Trace): void { assert.equal(trace.externalNetworkCalls, 0); assert.equal(trace.replyCalls, 0); assert.equal(trace.locatorProjection.mode, "RAW_COMPOSITE"); assert.equal(trace.locatorProjection.locatorOK, true); }
function writtenTables(trace: Trace): string[] { return trace.committedDml.map((sql) => /^(?:INSERT INTO|UPDATE)\s+(\w+)/i.exec(sql)?.[1] ?? ""); }

async function collect(): Promise<Record<string, unknown>> {
  reset("success");
  const success = run({ role: "PRIMARY", scenario: "success" }, "success");
  assert.equal(success.committedRows, 4);
  assert.deepEqual(success.attempts[0]?.lockOrder, ["object_furniture_operation_replays", "object_owned_furniture_instances", "object_home_furniture_placements"]);
  assert.deepEqual(writtenTables(success), ["object_furniture_operation_replays", "object_home_furniture_placements", "object_furniture_ownership_history", "object_owned_furniture_instances"]);
  assertNoExternalEffects(success);

  reset("rollback"); run({ mode: "SEED_COLLISION" }, "rollback-collision");
  const rollback = run({ role: "PRIMARY", scenario: "rollback" }, "rollback");
  assert.equal(rollback.committedRows, 0); assert.equal(rollback.rolledBackAffectedRows, 1); assert.equal(rollback.beforeSha256, rollback.afterSha256);
  assert.match(rollback.errorCode ?? "", /PLACEMENT_ID_COLLISION_RETRY_EXHAUSTED/);
  assert.deepEqual(rollback.attempts[0]?.failure, { code: "ER_DUP_ENTRY", errno: 1062, errorKind: "BUSINESS_UNIQUE_CONFLICT", constraintName: "PRIMARY" });

  reset("duplicate");
  const duplicateSeed = run({ role: "SEED", scenario: "duplicate" }, "duplicate-seed");
  const duplicateReplay = run({ role: "REPLAY", scenario: "duplicate" }, "duplicate-replay");
  assert.equal(duplicateSeed.committedRows, 4); assert.equal(duplicateReplay.committedRows, 0); assert.equal(duplicateReplay.replayed, true); assert.equal(duplicateReplay.beforeSha256, duplicateReplay.afterSha256);

  reset("drift");
  const driftSeed = run({ role: "SEED", scenario: "drift" }, "drift-seed");
  const drift = run({ role: "PRIMARY", scenario: "drift", drift: true }, "drift");
  assert.equal(driftSeed.committedRows, 4); assert.equal(drift.committedRows, 0); assert.match(drift.errorCode ?? "", /IDEMPOTENCY_CONFLICT/); assert.equal(drift.beforeSha256, drift.afterSha256);

  reset("restart");
  const restartSeed = run({ role: "SEED", scenario: "restart" }, "restart-seed");
  const restartReplay = run({ role: "REPLAY", scenario: "restart" }, "restart-replay");
  assert.notEqual(restartSeed.processId, restartReplay.processId); assert.equal(restartReplay.committedRows, 0); assert.equal(restartReplay.replayed, true); assert.equal(restartReplay.beforeSha256, restartReplay.afterSha256);

  reset("concurrency");
  const concurrentPair = await Promise.all([
    runConcurrent({ role: "CONCURRENT", scenario: "concurrency", identityPrefix: "a" }, "concurrency-a"),
    runConcurrent({ role: "CONCURRENT", scenario: "concurrency", identityPrefix: "b" }, "concurrency-b"),
  ]);
  const writers = concurrentPair.filter((trace) => trace.committedRows === 4);
  const replays = concurrentPair.filter((trace) => trace.committedRows === 0 && trace.replayed === true);
  assert.equal(writers.length, 1); assert.equal(replays.length, 1); assert.equal(writers[0]?.afterSha256, replays[0]?.afterSha256);
  for (const trace of [rollback, duplicateSeed, duplicateReplay, driftSeed, drift, restartSeed, restartReplay, ...concurrentPair]) assertNoExternalEffects(trace);

  const source = readFileSync(resolve(runtimeRoot, "src/home/canonical-furniture-home-repository.ts"), "utf8").replace(/\r\n?/g, "\n");
  return {
    contractVersion: "WBS787_FURNITURE_PLACE_TARGETED_V1",
    consumerId: "sql-repository-818137c4fb22037a",
    sliceId: "SL-FURNITURE-PLACE-MUTATION-PARITY-01",
    executionId: "가구배치DB-SL-FURNITURE-PLACE-MUTATION-PARITY-01-20260909074941",
    leaseRow: 2615,
    baselineCommit: "24fac92e9b73fb112dc75177945cc33326c272ad",
    sourceMethod: deriveUniqueClassMethodSourceSpan(source, "MariaCanonicalFurnitureHomeRepository", "placeOwnedFurniture"),
    migrationClosure: ["443_object_identity_audit_provider.sql", "444_canonical_item_inventory.sql", "445_object_furniture_home_canonical_model.sql"],
    scenarios: { success, rollback, duplicate: [duplicateSeed, duplicateReplay], drift: [driftSeed, drift], restart: [restartSeed, restartReplay], concurrency: concurrentPair },
  };
}

try {
  const evidence = await collect();
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", scenarios: 6, evidencePath }));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
