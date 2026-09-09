import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { validateObjectDbMutationScenarioEvidence, type ObjectDbMutationScenarioEvidence, type ObjectDbMutationScenarioOracle, type ObjectDbMutationTrace } from "../src/data-migration/object-db-consumer-mutation-evidence.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const fixturePath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave23-mutations-v1.json");
const targetPath = resolve(runtimeRoot, "test/fixtures/object-db-executable-parity-wave23-target.mjs");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runRoot = mkdtempSync(join(tmpdir(), "wave23-mutations-live-"));
const databaseNames: Record<string, string> = {
  "sql-repository-818137c4fb22037a": "hoibot_wbs787_furniture_place_2615_wave23",
  "sql-repository-f6c531148a436a21": "hoibot_wave23_mini_pet_acquire_2619",
  "sql-repository-31c4099080d9c9c1": "hoibot_wbs789_pet_skill_grant_2617_wave23",
};
const hashRows = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function stableRows(consumerId: string, exactRows: Record<string, Array<Record<string, unknown>>>): Record<string, Array<Record<string, unknown>>> {
  if (consumerId === "sql-repository-818137c4fb22037a") return exactRows;
  return Object.fromEntries(Object.entries(exactRows).map(([table, rows]) => [table, rows.map((row) => {
    const stable = { ...row };
    if ("owned_mini_pet_id" in stable) stable.owned_mini_pet_id = "OWNED_ID";
    if ("mini_pet_operation_id" in stable) stable.mini_pet_operation_id = "OPERATION_ID";
    if ("owned_pet_skill_id" in stable) stable.owned_pet_skill_id = "OWNED_ID";
    if ("pet_skill_operation_id" in stable) stable.pet_skill_operation_id = "OPERATION_ID";
    return stable;
  })]));
}

function rawRun(consumerId: string, request: Record<string, unknown>, name: string): Record<string, any> {
  const input = join(runRoot, `${name}.input.json`), output = join(runRoot, `${name}.output.json`);
  writeFileSync(input, JSON.stringify({ consumerId, ...request }), "utf8");
  execFileSync(process.execPath, ["--import", "tsx", targetPath, input, output], { cwd: runtimeRoot, env: { ...process.env, DATABASE_NAME: databaseNames[consumerId] }, stdio: "pipe", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(readFileSync(output, "utf8"));
}

async function rawConcurrent(consumerId: string, request: Record<string, unknown>, name: string): Promise<Record<string, any>> {
  const input = join(runRoot, `${name}.input.json`), output = join(runRoot, `${name}.output.json`);
  writeFileSync(input, JSON.stringify({ consumerId, ...request }), "utf8");
  await new Promise<void>((accept, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", targetPath, input, output], { cwd: runtimeRoot, env: { ...process.env, DATABASE_NAME: databaseNames[consumerId] }, stdio: "pipe" });
    let error = "";
    child.stderr.on("data", (value) => { error += String(value); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? accept() : reject(new Error(`Wave23 concurrent child failed (${code}): ${error}`)));
  });
  return JSON.parse(readFileSync(output, "utf8"));
}

const state = (rows: Record<string, unknown[]>, tables: string[]): Record<string, number> => Object.fromEntries(tables.map((table) => [table, rows[table]?.length ?? 0]));
function locator(consumerId: string, scenario: string, raw: Record<string, any>): ObjectDbMutationTrace["locatorProjection"] {
  const key = consumerId === "sql-repository-818137c4fb22037a"
    ? { player_id: "player01", idempotency_scope: "wbs787.place", idempotency_key: `request-${scenario}` }
    : { player_id: "player01", request_key: `request-${scenario}` };
  const stable = stableRows(consumerId, { locator: raw.locatorProjection.rows }).locator!;
  return { mode: "RAW_COMPOSITE", key, rows: stable, locatorOK: true } as ObjectDbMutationTrace["locatorProjection"];
}
function trace(caseFixture: any, raw: Record<string, any>, role: ObjectDbMutationTrace["role"], scenario: string): ObjectDbMutationTrace {
  const attempts = raw.attempts.map((attempt: any) => ({
    attempt: attempt.number,
    outcome: attempt.outcome,
    attemptedDmlStatements: attempt.attemptedDml ?? attempt.targetDml,
    affectedDmlStatements: attempt.affectedDml ?? attempt.targetDml,
    affectedRowCount: attempt.affectedRows ?? attempt.targetAffectedRows,
    lockOrder: attempt.lockOrder,
    failure: attempt.failure,
  }));
  const lockOrder = attempts.at(-1)?.lockOrder ?? [];
  const beforeRows = stableRows(caseFixture.consumerId, raw.beforeRows);
  const afterRows = stableRows(caseFixture.consumerId, raw.afterRows);
  return {
    processId: raw.processId, moduleExecutionId: raw.moduleExecutionId, role, source: caseFixture.mutationContract.source, database: raw.database,
    transactionAttempts: attempts, committedDmlStatements: raw.committedDml, committedRowCount: raw.committedRows,
    rolledBackAffectedRowCount: raw.rolledBackAffectedRows, lockOrder,
    before: state(beforeRows, caseFixture.mutationContract.allowedTables), after: state(afterRows, caseFixture.mutationContract.allowedTables),
    replayed: raw.replayed, errorCode: raw.errorCode, externalNetworkCalls: raw.externalNetworkCalls, replyCalls: raw.replyCalls,
    locatorProjection: locator(caseFixture.consumerId, scenario, raw), beforeRows, afterRows,
    beforeSha256: hashRows(beforeRows), afterSha256: hashRows(afterRows),
  };
}

function reset(consumerId: string, name: string): void { rawRun(consumerId, { mode: "RESET" }, `${name}-reset`); }
function setupFailure(consumerId: string, name: string): void {
  rawRun(consumerId, { mode: consumerId === "sql-repository-818137c4fb22037a" ? "SEED_COLLISION" : "FAIL_REPLAY" }, `${name}-failure-setup`);
}
function oracle(evidence: ObjectDbMutationScenarioEvidence): ObjectDbMutationScenarioOracle {
  const primaryRole = evidence.scenarioKind === "DUPLICATE_REPLAY_DML_ZERO" || evidence.scenarioKind === "RESTART_REPLAY" ? "REPLAY" : "PRIMARY";
  const primary = evidence.traces.find(({ role }) => role === primaryRole)!;
  const attempt = primary.transactionAttempts.at(-1)!;
  const table = (sql: string): string => /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i.exec(sql)![1]!;
  return {
    scenarioKind: evidence.scenarioKind, traceRoles: evidence.traces.map(({ role }) => role), primaryRole,
    primaryTransactionOutcome: attempt.outcome, primaryTransactionAttempts: primary.transactionAttempts.length,
    expectedAttemptedDmlTableSequence: attempt.attemptedDmlStatements.map(table), expectedAffectedDmlTableSequence: attempt.affectedDmlStatements.map(table),
    expectedDmlTableSequence: primary.committedDmlStatements.map(table), expectedLockOrder: primary.lockOrder,
    expectedCommittedRowCount: primary.committedRowCount, expectedRolledBackAffectedRowCount: primary.rolledBackAffectedRowCount,
    expectedBefore: primary.before, expectedAfter: primary.after, expectedReplayed: primary.replayed, expectedErrorCode: primary.errorCode,
    distinctProcessRoles: evidence.scenarioKind === "RESTART_REPLAY" ? ["SEED", "REPLAY"] : evidence.scenarioKind === "CONCURRENCY_SINGLE_WRITER" ? ["PRIMARY", "CONCURRENT"] : [],
    expectedAttemptFailures: primary.transactionAttempts.map(({ failure }) => failure), expectedLockOrderByAttempt: primary.transactionAttempts.map(({ lockOrder }) => lockOrder ?? []),
    expectedBeforeRows: primary.beforeRows, expectedAfterRows: primary.afterRows, expectedLocatorProjection: primary.locatorProjection,
    expectedBeforeSha256: primary.beforeSha256, expectedAfterSha256: primary.afterSha256,
  };
}

async function collect(caseFixture: any): Promise<ObjectDbMutationScenarioEvidence[]> {
  const id = caseFixture.consumerId;
  const one = (request: Record<string, unknown>, role: ObjectDbMutationTrace["role"], scenario: string, name: string) => trace(caseFixture, rawRun(id, { role, scenario, ...request }, name), role, scenario);
  const result: ObjectDbMutationScenarioEvidence[] = [];
  reset(id, `${id}-success`); result.push({ scenarioKind: "MUTATION_SUCCESS", traces: [one({}, "PRIMARY", "success", `${id}-success`)] });
  reset(id, `${id}-failure`); setupFailure(id, id); result.push({ scenarioKind: "DOMAIN_FAILURE_ROLLBACK", traces: [one({}, "PRIMARY", "rollback", `${id}-failure`)] });
  reset(id, `${id}-duplicate`); result.push({ scenarioKind: "DUPLICATE_REPLAY_DML_ZERO", traces: [one({}, "SEED", "duplicate", `${id}-duplicate-seed`), one({}, "REPLAY", "duplicate", `${id}-duplicate-replay`)] });
  reset(id, `${id}-drift`); result.push({ scenarioKind: "PAYLOAD_DRIFT_FAIL_CLOSED", traces: [one({}, "SEED", "drift", `${id}-drift-seed`), one({ drift: true, quantity: 4 }, "PRIMARY", "drift", `${id}-drift-primary`)] });
  reset(id, `${id}-restart`); result.push({ scenarioKind: "RESTART_REPLAY", traces: [one({}, "SEED", "restart", `${id}-restart-seed`), one({}, "REPLAY", "restart", `${id}-restart-replay`)] });
  reset(id, `${id}-concurrency`);
  const pairRaw = await Promise.all([rawConcurrent(id, { role: "CONCURRENT", scenario: "concurrency" }, `${id}-concurrency-a`), rawConcurrent(id, { role: "CONCURRENT", scenario: "concurrency" }, `${id}-concurrency-b`)]);
  const pair = pairRaw.map((raw) => trace(caseFixture, raw, "CONCURRENT", "concurrency"));
  const writer = pair.find((candidate) => candidate.committedRowCount > 0), replay = pair.find((candidate) => candidate !== writer);
  if (!writer || !replay || replay.replayed !== true || replay.committedRowCount !== 0) throw new Error(`Wave23 concurrency cardinality drift: ${id}`);
  writer.role = "PRIMARY"; result.push({ scenarioKind: "CONCURRENCY_SINGLE_WRITER", traces: [writer, replay] });
  const failure = result[1]!.traces[0]!;
  if (failure.transactionAttempts.at(-1)?.outcome !== "ROLLBACK" || failure.committedRowCount !== 0 || failure.rolledBackAffectedRowCount < 1) throw new Error(`Wave23 rollback invariant drift: ${id}`);
  for (const evidence of result.filter(({ scenarioKind }) => ["DUPLICATE_REPLAY_DML_ZERO", "RESTART_REPLAY"].includes(scenarioKind))) {
    const replayTrace = evidence.traces.find(({ role }) => role === "REPLAY")!;
    if (!replayTrace.replayed || replayTrace.committedRowCount !== 0 || JSON.stringify(replayTrace.before) !== JSON.stringify(replayTrace.after)) throw new Error(`Wave23 replay invariant drift: ${id}`);
  }
  const drift = result[3]!.traces.find(({ role }) => role === "PRIMARY")!;
  if (drift.committedRowCount !== 0 || JSON.stringify(drift.before) !== JSON.stringify(drift.after)) throw new Error(`Wave23 drift invariant drift: ${id}`);
  caseFixture.mutationContract.scenarios = result.map(oracle);
  for (const evidence of result) validateObjectDbMutationScenarioEvidence(caseFixture.mutationContract, evidence);
  return result;
}

try {
  for (const caseFixture of fixture.cases) {
    caseFixture.sealedObservations = await collect(caseFixture);
  }
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", consumers: fixture.cases.length, scenarios: fixture.cases.reduce((sum: number, value: any) => sum + value.sealedObservations.length, 0) }));
} finally { rmSync(runRoot, { recursive: true, force: true }); }
