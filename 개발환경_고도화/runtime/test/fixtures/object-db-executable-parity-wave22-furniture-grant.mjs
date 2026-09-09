import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCanonicalFurnitureHomeRepository } from "../../src/home/canonical-furniture-home-repository.js";
import { classifyMariaDatabaseError } from "../../src/shared/maria-database-error-policy.js";

const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const DML = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+/i;
const TABLES = ["object_owned_furniture_instances", "object_furniture_operation_replays"];

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Wave22 missing environment: ${name}`); return value; }
function config() {
  const result = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wave22-no-iris-token", USER_VERIFICATION_PEPPER: "wave22-no-user-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
  if (result.database.host !== "127.0.0.1" || result.database.port === 3306 || !result.database.name.startsWith("hoibot_wave22_furniture_grant")) throw new Error("Wave22 database isolation rejected");
  return result.database;
}

async function reset(database) {
  await database.execute("DELETE FROM object_furniture_operation_replays");
  await database.execute("DELETE FROM object_owned_furniture_instances");
  await database.execute("DELETE FROM object_furniture_definitions");
  await database.execute("DELETE FROM canonical_players");
}
async function seedDomain(database) {
  const audit = ["wave22-fixture", "2026-09-09 06:00:00", "wave22-fixture", "2026-09-09 06:00:00"];
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('player01','WAVE22','player',?,?,?,?)", audit);
  for (const [id, name, base, step] of [["furnit01", "합성 가구 1", 120, 15], ["furnit02", "합성 가구 2", 80, 8]]) await database.execute("INSERT INTO object_furniture_definitions(furniture_id,display_name,purchase_price,base_charm,charm_per_enhancement,active,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,500,?,?,TRUE,?,?,?,?)", [id, name, base, step, ...audit]);
}
async function seedCollision(database) {
  const audit = ["wave22-fixture", "2026-09-09 06:00:00", "wave22-fixture", "2026-09-09 06:00:00"];
  await database.execute("INSERT INTO object_owned_furniture_instances(owned_furniture_id,player_id,furniture_id,enhancement_level,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('seedown1','player01','furnit01',0,'bag',?,?,?,?)", audit);
  await database.execute("INSERT INTO object_furniture_operation_replays(furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('collide1','player01','wave22.seed','collision','seed','ec2c8919c203dde483462ff6f364b963e21ffa255aca48ad26b57158bfbc0ef7','seedown1','granted',?,?,?,?)", audit);
}

const canonicalValue = (value) => typeof value === "bigint" ? value.toString() : value;
const canonicalRows = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonicalValue(value)])));
async function exactRows(database) {
  const owned = await database.query("SELECT owned_furniture_id,player_id,furniture_id,enhancement_level,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_owned_furniture_instances ORDER BY owned_furniture_id");
  const replay = await database.query("SELECT furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_furniture_operation_replays ORDER BY furniture_operation_id");
  return { object_owned_furniture_instances: canonicalRows(owned), object_furniture_operation_replays: canonicalRows(replay) };
}
const counts = (rows) => Object.fromEntries(TABLES.map((table) => [table, rows[table].length]));
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scenarioInput = (key, drift = false) => ({ actor: "wave22-fixture", playerId: "player01", furnitureId: drift ? "furnit02" : "furnit01", enhancementLevel: 3n, idempotencyScope: "wave22.grant", idempotencyKey: `request-${key}` });
function generator(request) {
  if (request.domainFailure === true) { let first = true; return () => { if (first) { first = false; return "failown1"; } return "collide1"; }; }
  const ids = {
    success: ["sown0001", "srep0001"], duplicate: ["down0001", "drep0001"], drift: ["rown0001", "rrep0001"],
    restart: ["town0001", "trep0001"], concurrency: ["cown0001", "crep0001"],
  }[request.scenarioKey];
  if (!ids) throw new Error("Wave22 identity scenario missing");
  let ordinal = 0; return () => ids[Math.min(ordinal++, ids.length - 1)];
}
function classifyFailure(error) {
  let candidate = error;
  for (let depth = 0; depth < 4 && candidate !== undefined; depth += 1) {
    const classified = classifyMariaDatabaseError(candidate);
    if (classified.kind !== "OTHER") return { code: classified.code ?? null, errno: classified.errno ?? null, errorKind: classified.kind, constraintName: classified.constraintName ?? null };
    candidate = candidate && typeof candidate === "object" && "cause" in candidate ? candidate.cause : undefined;
  }
  return null;
}
function traced(database) {
  const attempts = [], locks = [];
  const root = async (work) => {
    const record = { attempt: attempts.length + 1, outcome: "ROLLBACK", attemptedDmlStatements: [], affectedDmlStatements: [], affectedRowCount: 0, lockOrder: [], failure: null };
    attempts.push(record);
    try {
      const result = await database.withTransaction(async (transaction) => work({
        query: async (sql, values = []) => { const normalized = NORMALIZE(sql); if (/\bFOR UPDATE\b/i.test(normalized)) for (const match of normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) { if (!record.lockOrder.includes(match[1])) record.lockOrder.push(match[1]); if (!locks.includes(match[1])) locks.push(match[1]); } return transaction.query(sql, values); },
        execute: async (sql, values = []) => { const normalized = NORMALIZE(sql), dml = DML.test(normalized); if (dml) record.attemptedDmlStatements.push(normalized); const result = await transaction.execute(sql, values); if (dml) { record.affectedDmlStatements.push(normalized); record.affectedRowCount += Number(result.affectedRows); } return result; },
      }));
      record.outcome = "COMMIT"; return result;
    } catch (error) { record.failure = classifyFailure(error); throw error; }
  };
  return { attempts, locks, client: { ping: () => database.ping(), verifyRollback: () => database.verifyRollback(), query: (sql, values = []) => database.query(sql, values), execute: (sql, values = []) => database.execute(sql, values), withTransaction: root, withRootTransaction: root, close: async () => undefined } };
}
async function locatorProjection(database, input) {
  const rows = canonicalRows(await database.query("SELECT furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status FROM object_furniture_operation_replays WHERE player_id=? AND idempotency_scope=? AND idempotency_key=? ORDER BY furniture_operation_id", [input.playerId, input.idempotencyScope, input.idempotencyKey]));
  const locatorOK = rows.every((row) => row.player_id === input.playerId && row.idempotency_scope === input.idempotencyScope && row.idempotency_key === input.idempotencyKey);
  return { mode: "RAW_COMPOSITE", playerId: input.playerId, idempotencyScope: input.idempotencyScope, idempotencyKey: input.idempotencyKey, rows, locatorOK };
}
async function execute(request) {
  const databaseConfig = config(), database = createDatabaseClient(databaseConfig);
  try {
    if (request.mode === "RESET") { await reset(database); await seedDomain(database); return { reset: true, processId: process.pid }; }
    if (request.domainFailure === true) await seedCollision(database);
    const beforeRows = await exactRows(database), trace = traced(database), callInput = scenarioInput(request.scenarioKey, request.drift === true);
    let replayed = null, failure = null;
    try { replayed = (await new MariaCanonicalFurnitureHomeRepository(trace.client, generator(request), (actor) => ({ INSERT_USER: actor, INSERT_TIME: "2026-09-09 06:00:00", UPDATE_USER: actor, UPDATE_TIME: "2026-09-09 06:00:00" })).grantOwnedFurniture(callInput)).replayed; }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }
    const afterRows = await exactRows(database), committed = trace.attempts.filter(({ outcome }) => outcome === "COMMIT"), rolledBack = trace.attempts.filter(({ outcome }) => outcome === "ROLLBACK");
    return { processId: process.pid, moduleExecutionId: randomUUID(), role: request.role, source: request.source, database: { host: databaseConfig.host, port: databaseConfig.port, name: databaseConfig.name }, transactionAttempts: trace.attempts, committedDmlStatements: committed.flatMap(({ affectedDmlStatements }) => affectedDmlStatements), committedRowCount: committed.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0), rolledBackAffectedRowCount: rolledBack.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0), lockOrder: trace.locks, before: counts(beforeRows), after: counts(afterRows), replayed, errorCode: failure, externalNetworkCalls: 0, replyCalls: 0, locatorProjection: await locatorProjection(database, callInput), beforeRows, afterRows, beforeSha256: stableHash(beforeRows), afterSha256: stableHash(afterRows) };
  } finally { await database.close(); }
}

const [inputPath, outputPath] = process.argv.slice(2);
if (inputPath && outputPath) { const request = JSON.parse(readFileSync(resolve(inputPath), "utf8")); try { writeFileSync(resolve(outputPath), JSON.stringify(await execute(request)), "utf8"); } catch (error) { console.error(error); process.exitCode = 1; } }
export { execute as executeWave22FurnitureGrant };
