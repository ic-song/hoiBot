import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCanonicalPetSkillRepository } from "../../src/pet/maria-canonical-pet-skill-repository.js";
import { classifyMariaDatabaseError } from "../../src/shared/maria-database-error-policy.js";

const TARGET = /^(?:INSERT INTO|UPDATE)\s+(canonical_owned_pet_skill_stacks|canonical_pet_skill_operation_replays)\b/i;
const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`WBS789 missing environment: ${name}`); return value; };
function config() {
  const database = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wbs789-no-iris-token", USER_VERIFICATION_PEPPER: "wbs789-no-user-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") }).database;
  if (database.host !== "127.0.0.1" || database.port === 3306 || !database.name.startsWith("hoibot_wbs789_pet_skill_grant_2617")) throw new Error("WBS789 database isolation rejected");
  return database;
}
const audit = ["wbs789-fixture", "2026-09-09 09:00:00", "wbs789-fixture", "2026-09-09 09:00:00"];
async function reset(database) {
  await database.execute("DROP TRIGGER IF EXISTS wbs789_fail_replay");
  await database.execute("DELETE FROM canonical_pet_skill_operation_replays");
  await database.execute("DELETE FROM canonical_owned_pet_skill_equipments");
  await database.execute("DELETE FROM canonical_owned_pet_skill_stacks");
  await database.execute("DELETE FROM canonical_pet_skill_definition_imports");
  await database.execute("DELETE FROM canonical_pet_skill_definitions");
  await database.execute("DELETE FROM canonical_owned_pet_instances");
  await database.execute("DELETE FROM object_identity_crosswalks");
  await database.execute("DELETE FROM object_identities");
  await database.execute("DELETE FROM canonical_players");
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('player01','WBS789','player',?,?,?,?)", audit);
  await database.execute("INSERT INTO canonical_pet_skill_definitions(pet_skill_id,pet_skill_name,pet_skill_description,pet_skill_grade,handler_key,options_json,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('skill001','대상 펫스킬',NULL,NULL,'presentation_only','{}',TRUE,?,?,?,?)", audit);
}
const canonical = (value) => typeof value === "bigint" ? value.toString() : value;
const rows = (values) => values.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonical(value)])));
async function exactRows(database) {
  return {
    canonical_owned_pet_skill_stacks: rows(await database.query("SELECT owned_pet_skill_id,player_id,pet_skill_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_owned_pet_skill_stacks ORDER BY owned_pet_skill_id")),
    canonical_pet_skill_operation_replays: rows(await database.query("SELECT pet_skill_operation_id,player_id,request_key,operation_kind,payload_fingerprint,pet_skill_id,owned_pet_id,owned_pet_skill_equipment_id,resulting_quantity,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_pet_skill_operation_replays ORDER BY pet_skill_operation_id")),
  };
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function failure(error) {
  let value = error;
  for (let depth = 0; depth < 5 && value; depth += 1) {
    const found = classifyMariaDatabaseError(value);
    if (found.kind !== "OTHER") return { code: found.code ?? null, errno: found.errno ?? null, errorKind: found.kind, constraintName: found.constraintName ?? null };
    value = typeof value === "object" && "cause" in value ? value.cause : undefined;
  }
  return null;
}
function traced(database) {
  const attempts = [];
  const root = async (work) => {
    const attempt = { number: attempts.length + 1, outcome: "ROLLBACK", lockOrder: [], targetDml: [], targetAffectedRows: 0, failure: null };
    attempts.push(attempt);
    try {
      const result = await database.withTransaction(async (transaction) => work({
        query: async (sql, values = []) => { const normalized = NORMALIZE(sql); if (/\bFOR UPDATE\b/i.test(normalized)) for (const match of normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) { const lock = match[1] === "object_identity_crosswalks" ? `${match[1]}:${String(values[1])}` : match[1]; if (!attempt.lockOrder.includes(lock)) attempt.lockOrder.push(lock); } return transaction.query(sql, values); },
        execute: async (sql, values = []) => { const normalized = NORMALIZE(sql); const target = TARGET.test(normalized); const result = await transaction.execute(sql, values); if (target) { attempt.targetDml.push(normalized); attempt.targetAffectedRows += Number(result.affectedRows); } return result; },
      }));
      attempt.outcome = "COMMIT";
      return result;
    } catch (error) { attempt.failure = failure(error); throw error; }
  };
  return { attempts, client: { ping: () => database.ping(), verifyRollback: () => database.verifyRollback(), query: (sql, values = []) => database.query(sql, values), execute: (sql, values = []) => database.execute(sql, values), withTransaction: root, withRootTransaction: root, close: async () => undefined } };
}
function input(request) {
  const same = request.scenario === "same-key";
  return { actor: "wbs789-fixture", playerId: "player01", petSkillId: "skill001", quantity: BigInt(request.quantity ?? 3), requestKey: same ? "same-key" : `request-${request.scenario}${request.keySuffix ?? ""}` };
}
async function execute(request) {
  const databaseConfig = config();
  const database = createDatabaseClient(databaseConfig);
  try {
    if (request.mode === "RESET") { await reset(database); return { reset: true, processId: process.pid }; }
    if (request.mode === "FAIL_REPLAY") { await database.execute("CREATE TRIGGER wbs789_fail_replay BEFORE INSERT ON canonical_pet_skill_operation_replays FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WBS789 forced replay failure'"); return { seeded: true, processId: process.pid }; }
    const beforeRows = await exactRows(database);
    const trace = traced(database);
    const callInput = input(request);
    let replayed = null, resultingQuantity = null, operationId = null, errorCode = null;
    try {
      const result = await new MariaCanonicalPetSkillRepository(trace.client).grant(callInput);
      replayed = result.replayed; resultingQuantity = result.resultingQuantity.toString(); operationId = result.petSkillOperationId;
    } catch (error) { errorCode = error instanceof Error ? error.message : String(error); }
    const afterRows = await exactRows(database);
    const committed = trace.attempts.filter((attempt) => attempt.outcome === "COMMIT"), rolledBack = trace.attempts.filter((attempt) => attempt.outcome === "ROLLBACK");
    const locatorRows = rows(await database.query("SELECT pet_skill_operation_id,player_id,request_key,operation_kind,payload_fingerprint,pet_skill_id,owned_pet_id,owned_pet_skill_equipment_id,resulting_quantity,operation_status FROM canonical_pet_skill_operation_replays WHERE player_id=? AND request_key=?", [callInput.playerId, callInput.requestKey]));
    return { processId: process.pid, moduleExecutionId: randomUUID(), scenario: request.scenario, database: { host: databaseConfig.host, port: databaseConfig.port, name: databaseConfig.name }, attempts: trace.attempts, committedDml: committed.flatMap((attempt) => attempt.targetDml), committedRows: committed.reduce((sum, attempt) => sum + attempt.targetAffectedRows, 0), rolledBackAffectedRows: rolledBack.reduce((sum, attempt) => sum + attempt.targetAffectedRows, 0), replayed, resultingQuantity, operationId, errorCode, beforeRows, afterRows, beforeSha256: hash(beforeRows), afterSha256: hash(afterRows), locatorProjection: { mode: "RAW_COMPOSITE", rows: locatorRows, locatorOK: locatorRows.every((row) => row.player_id === callInput.playerId && row.request_key === callInput.requestKey) }, externalNetworkCalls: 0, replyCalls: 0 };
  } finally { await database.close(); }
}

const [inputPath, outputPath] = process.argv.slice(2);
if (inputPath && outputPath) {
  const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  try { writeFileSync(resolve(outputPath), JSON.stringify(await execute(request)), "utf8"); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
