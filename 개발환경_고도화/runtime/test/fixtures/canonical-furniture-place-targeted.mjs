import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCanonicalFurnitureHomeRepository } from "../../src/home/canonical-furniture-home-repository.js";
import { classifyMariaDatabaseError } from "../../src/shared/maria-database-error-policy.js";

const TABLES = ["object_owned_furniture_instances", "object_home_furniture_placements", "object_furniture_operation_replays", "object_furniture_ownership_history"];
const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const DML = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+/i;
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`WBS787 missing environment: ${name}`); return value; };
function config() {
  const database = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wbs787-no-iris-token", USER_VERIFICATION_PEPPER: "wbs787-no-user-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") }).database;
  if (database.host !== "127.0.0.1" || database.port === 3306 || !database.name.startsWith("hoibot_wbs787_furniture_place_2615")) throw new Error("WBS787 database isolation rejected");
  return database;
}
const audit = ["wbs787-fixture", "2026-09-09 08:00:00", "wbs787-fixture", "2026-09-09 08:00:00"];
async function reset(database) {
  await database.execute("DELETE FROM object_furniture_ownership_history");
  await database.execute("DELETE FROM object_home_furniture_placements");
  await database.execute("DELETE FROM object_furniture_operation_replays");
  await database.execute("DELETE FROM object_owned_furniture_instances");
  await database.execute("DELETE FROM object_furniture_definitions");
  await database.execute("DELETE FROM canonical_players");
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('player01','WBS787','player',?,?,?,?)", audit);
  await database.execute("INSERT INTO object_furniture_definitions(furniture_id,display_name,purchase_price,base_charm,charm_per_enhancement,active,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('furnit01','합성 배치 가구',500,120,15,TRUE,?,?,?,?)", audit);
  for (const ownedId of ["owner001", "owner002"]) await database.execute("INSERT INTO object_owned_furniture_instances(owned_furniture_id,player_id,furniture_id,enhancement_level,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'player01','furnit01',0,'bag',?,?,?,?)", [ownedId, ...audit]);
}
async function seedPlacementCollision(database) {
  await database.execute("INSERT INTO object_home_furniture_placements(home_furniture_placement_id,owned_furniture_id,placement_order,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('plseed01','owner002',99,?,?,?,?)", audit);
}
const canonical = (value) => typeof value === "bigint" ? value.toString() : value;
const canonicalRows = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonical(value)])));
async function exactRows(database) {
  return {
    object_owned_furniture_instances: canonicalRows(await database.query("SELECT owned_furniture_id,player_id,furniture_id,enhancement_level,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_owned_furniture_instances ORDER BY owned_furniture_id")),
    object_home_furniture_placements: canonicalRows(await database.query("SELECT home_furniture_placement_id,owned_furniture_id,placement_order,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_home_furniture_placements ORDER BY home_furniture_placement_id")),
    object_furniture_operation_replays: canonicalRows(await database.query("SELECT furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_furniture_operation_replays ORDER BY furniture_operation_id")),
    object_furniture_ownership_history: canonicalRows(await database.query("SELECT furniture_ownership_history_id,owned_furniture_id,furniture_operation_id,status_before,status_after,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_furniture_ownership_history ORDER BY furniture_ownership_history_id")),
  };
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function failure(error) {
  let candidate = error;
  for (let depth = 0; depth < 4 && candidate !== undefined; depth += 1) {
    const classified = classifyMariaDatabaseError(candidate);
    if (classified.kind !== "OTHER") return { code: classified.code ?? null, errno: classified.errno ?? null, errorKind: classified.kind, constraintName: classified.constraintName ?? null };
    candidate = candidate && typeof candidate === "object" && "cause" in candidate ? candidate.cause : undefined;
  }
  return null;
}
function traced(database) {
  const attempts = [];
  const root = async (work) => {
    const attempt = { number: attempts.length + 1, outcome: "ROLLBACK", lockOrder: [], attemptedDml: [], affectedDml: [], affectedRows: 0, failure: null };
    attempts.push(attempt);
    try {
      const result = await database.withTransaction(async (transaction) => work({
        query: async (sql, values = []) => { const normalized = NORMALIZE(sql); if (/\bFOR UPDATE\b/i.test(normalized)) for (const match of normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) if (!attempt.lockOrder.includes(match[1])) attempt.lockOrder.push(match[1]); return transaction.query(sql, values); },
        execute: async (sql, values = []) => { const normalized = NORMALIZE(sql), isDml = DML.test(normalized); if (isDml) attempt.attemptedDml.push(normalized); const result = await transaction.execute(sql, values); if (isDml) { attempt.affectedDml.push(normalized); attempt.affectedRows += Number(result.affectedRows); } return result; },
      }));
      attempt.outcome = "COMMIT";
      return result;
    } catch (error) { attempt.failure = failure(error); throw error; }
  };
  return { attempts, client: { ping: () => database.ping(), verifyRollback: () => database.verifyRollback(), query: (sql, values = []) => database.query(sql, values), execute: (sql, values = []) => database.execute(sql, values), withTransaction: root, withRootTransaction: root, close: async () => undefined } };
}
function generator(request) {
  if (request.scenario === "rollback") { let first = true; return () => { if (first) { first = false; return "opfail01"; } return "plseed01"; }; }
  const prefix = request.identityPrefix ?? ({ success: "s", duplicate: "d", drift: "x", restart: "r", concurrency: "c" }[request.scenario] ?? "z");
  const ids = [`op${prefix}00001`, `pl${prefix}00001`, `hi${prefix}00001`];
  let index = 0;
  return () => ids[Math.min(index++, ids.length - 1)];
}
function input(request) { return { actor: "wbs787-fixture", playerId: "player01", ownedFurnitureId: "owner001", placementOrder: BigInt(request.drift ? 8 : 7), idempotencyScope: "wbs787.place", idempotencyKey: `request-${request.scenario}` }; }
async function execute(request) {
  const databaseConfig = config();
  const database = createDatabaseClient(databaseConfig);
  try {
    if (request.mode === "RESET") { await reset(database); return { reset: true, processId: process.pid }; }
    if (request.mode === "SEED_COLLISION") { await seedPlacementCollision(database); return { seeded: true, processId: process.pid }; }
    const beforeRows = await exactRows(database);
    const trace = traced(database);
    const callInput = input(request);
    let replayed = null;
    let errorCode = null;
    try { replayed = (await new MariaCanonicalFurnitureHomeRepository(trace.client, generator(request), (actor) => ({ INSERT_USER: actor, INSERT_TIME: "2026-09-09 08:00:00", UPDATE_USER: actor, UPDATE_TIME: "2026-09-09 08:00:00" })).placeOwnedFurniture(callInput)).replayed; }
    catch (error) { errorCode = error instanceof Error ? error.message : String(error); }
    const afterRows = await exactRows(database);
    const committed = trace.attempts.filter((attempt) => attempt.outcome === "COMMIT");
    const rolledBack = trace.attempts.filter((attempt) => attempt.outcome === "ROLLBACK");
    const locatorRows = canonicalRows(await database.query("SELECT furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status FROM object_furniture_operation_replays WHERE player_id=? AND idempotency_scope=? AND idempotency_key=? ORDER BY furniture_operation_id", [callInput.playerId, callInput.idempotencyScope, callInput.idempotencyKey]));
    return { processId: process.pid, moduleExecutionId: randomUUID(), role: request.role, scenario: request.scenario, database: { host: databaseConfig.host, port: databaseConfig.port, name: databaseConfig.name }, attempts: trace.attempts, committedDml: committed.flatMap((attempt) => attempt.affectedDml), committedRows: committed.reduce((sum, attempt) => sum + attempt.affectedRows, 0), rolledBackAffectedRows: rolledBack.reduce((sum, attempt) => sum + attempt.affectedRows, 0), replayed, errorCode, beforeRows, afterRows, beforeSha256: hash(beforeRows), afterSha256: hash(afterRows), locatorProjection: { mode: "RAW_COMPOSITE", rows: locatorRows, locatorOK: locatorRows.every((row) => row.player_id === callInput.playerId && row.idempotency_scope === callInput.idempotencyScope && row.idempotency_key === callInput.idempotencyKey) }, externalNetworkCalls: 0, replyCalls: 0 };
  } finally { await database.close(); }
}

const [inputPath, outputPath] = process.argv.slice(2);
if (inputPath && outputPath) {
  const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  try { writeFileSync(resolve(outputPath), JSON.stringify(await execute(request)), "utf8"); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
export { execute as executeCanonicalFurniturePlaceTargeted };
