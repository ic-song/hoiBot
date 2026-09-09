import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCanonicalMiniPetRepository } from "../../src/mini-pet/canonical-mini-pet-repository.js";
import { classifyMariaDatabaseError } from "../../src/shared/maria-database-error-policy.js";

const CONSUMERS = {
  "sql-repository-818137c4fb22037a": "canonical-furniture-place-targeted.mjs",
  "sql-repository-31c4099080d9c9c1": "canonical-pet-skill-grant-targeted.mjs",
};
const MINI_PET_CONSUMER = "sql-repository-f6c531148a436a21";
const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const TARGET_DML = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(canonical_owned_mini_pet_instances|canonical_mini_pet_operation_replays)\b/i;
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`Wave23 missing environment: ${name}`); return value; };
const canonical = (value) => typeof value === "bigint" ? value.toString() : value;
const rows = (values) => values.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonical(value)])));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const audit = ["wave23-fixture", "2026-09-09 10:30:00", "wave23-fixture", "2026-09-09 10:30:00"];

function databaseConfig() {
  const database = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wave23-no-iris-token", USER_VERIFICATION_PEPPER: "wave23-no-user-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") }).database;
  if (database.host !== "127.0.0.1" || database.port === 3306 || !database.name.startsWith("hoibot_wave23_mini_pet_acquire_")) throw new Error("Wave23 mini-pet database isolation rejected");
  return database;
}

function classifiedFailure(error) {
  let candidate = error;
  for (let depth = 0; depth < 5 && candidate; depth += 1) {
    const found = classifyMariaDatabaseError(candidate);
    if (found.kind !== "OTHER") return { code: found.code ?? null, errno: found.errno ?? null, errorKind: found.kind, constraintName: found.constraintName ?? null };
    candidate = typeof candidate === "object" && "cause" in candidate ? candidate.cause : undefined;
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
        query: async (sql, values = []) => {
          const normalized = NORMALIZE(sql);
          if (/\bFOR UPDATE\b/i.test(normalized)) for (const match of normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) {
            const lock = match[1] === "object_identity_crosswalks" ? `${match[1]}:${String(values[1])}` : match[1];
            if (!attempt.lockOrder.includes(lock)) attempt.lockOrder.push(lock);
          }
          return transaction.query(sql, values);
        },
        execute: async (sql, values = []) => {
          const normalized = NORMALIZE(sql), target = TARGET_DML.test(normalized);
          if (target) attempt.targetDml.push(normalized);
          const result = await transaction.execute(sql, values);
          if (target) attempt.targetAffectedRows += Number(result.affectedRows);
          return result;
        },
      }));
      attempt.outcome = "COMMIT";
      return result;
    } catch (error) {
      attempt.failure = classifiedFailure(error);
      throw error;
    }
  };
  return { attempts, client: { ping: () => database.ping(), verifyRollback: () => database.verifyRollback(), query: (sql, values = []) => database.query(sql, values), execute: (sql, values = []) => database.execute(sql, values), withTransaction: root, withRootTransaction: root, close: async () => undefined } };
}

async function miniPetRows(database) {
  return {
    canonical_owned_mini_pet_instances: rows(await database.query("SELECT owned_mini_pet_id,player_id,mini_pet_id,enhancement_level,equipped_flag,bound_flag,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_owned_mini_pet_instances ORDER BY owned_mini_pet_id")),
    canonical_mini_pet_operation_replays: rows(await database.query("SELECT mini_pet_operation_id,player_id,request_key,operation_kind,payload_fingerprint,owned_mini_pet_id,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_mini_pet_operation_replays ORDER BY mini_pet_operation_id")),
  };
}

async function resetMiniPet(database) {
  await database.execute("DROP TRIGGER IF EXISTS wave23_fail_mini_replay");
  const identities = await database.query("SELECT object_identity_id FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_namespace IN ('miniPetOperation','ownedMiniPet')");
  await database.execute("DELETE FROM canonical_mini_pet_operation_replays");
  await database.execute("DELETE FROM canonical_owned_mini_pet_instances");
  await database.execute("DELETE FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_namespace IN ('miniPetOperation','ownedMiniPet')");
  for (const row of identities) await database.execute("DELETE FROM object_identities WHERE object_identity_id=?", [row.object_identity_id]);
  await database.execute("DELETE FROM canonical_mini_pet_definitions");
  await database.execute("DELETE FROM canonical_players");
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('player01','WAVE23','mini-pet-player',?,?,?,?)", audit);
  await database.execute("INSERT INTO canonical_mini_pet_definitions(mini_pet_id,mini_pet_name,mini_pet_emoji,mini_pet_grade,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('minipet1','Wave23 미니펫','🐣','synthetic',TRUE,?,?,?,?)", audit);
}

async function executeMiniPet(request) {
  const config = databaseConfig(), database = createDatabaseClient(config);
  try {
    if (request.mode === "RESET") { await resetMiniPet(database); return { reset: true, processId: process.pid }; }
    if (request.mode === "FAIL_REPLAY") { await database.execute("CREATE TRIGGER wave23_fail_mini_replay BEFORE INSERT ON canonical_mini_pet_operation_replays FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WAVE23 forced mini-pet replay failure'"); return { seeded: true, processId: process.pid }; }
    const beforeRows = await miniPetRows(database), trace = traced(database);
    const requestKey = `request-${request.scenario}`;
    const input = { actor: "wave23-fixture", playerId: "player01", miniPetId: "minipet1", requestKey, bound: Boolean(request.drift) };
    let replayed = null, errorCode = null;
    try { replayed = (await new MariaCanonicalMiniPetRepository(trace.client).acquire(input)).replayed; }
    catch (error) { errorCode = error instanceof Error ? error.message : String(error); }
    const afterRows = await miniPetRows(database);
    const committed = trace.attempts.filter((attempt) => attempt.outcome === "COMMIT"), rolledBack = trace.attempts.filter((attempt) => attempt.outcome === "ROLLBACK");
    const locatorRows = rows(await database.query("SELECT mini_pet_operation_id,player_id,request_key,operation_kind,payload_fingerprint,owned_mini_pet_id,operation_status FROM canonical_mini_pet_operation_replays WHERE player_id=? AND request_key=?", [input.playerId, input.requestKey]));
    return { processId: process.pid, moduleExecutionId: randomUUID(), scenario: request.scenario, database: { host: config.host, port: config.port, name: config.name }, attempts: trace.attempts, committedDml: committed.flatMap((attempt) => attempt.targetDml), committedRows: committed.reduce((sum, attempt) => sum + attempt.targetAffectedRows, 0), rolledBackAffectedRows: rolledBack.reduce((sum, attempt) => sum + attempt.targetAffectedRows, 0), replayed, errorCode, beforeRows, afterRows, beforeSha256: hash(beforeRows), afterSha256: hash(afterRows), locatorProjection: { mode: "RAW_COMPOSITE", key: { player_id: input.playerId, request_key: input.requestKey }, rows: locatorRows, locatorOK: locatorRows.every((row) => row.player_id === input.playerId && row.request_key === input.requestKey) }, externalNetworkCalls: 0, replyCalls: 0 };
  } finally { await database.close(); }
}

function runLegacyTarget(script, request) {
  const directory = mkdtempSync(join(tmpdir(), "wave23-target-"));
  try {
    const input = join(directory, "input.json"), output = join(directory, "output.json");
    writeFileSync(input, JSON.stringify(request), "utf8");
    execFileSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, script), input, output], { stdio: "pipe", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(readFileSync(output, "utf8"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function execute(request) {
  if (request.consumerId === MINI_PET_CONSUMER) return executeMiniPet(request);
  const script = CONSUMERS[request.consumerId];
  if (!script) throw new Error(`Wave23 unknown consumer: ${request.consumerId}`);
  return runLegacyTarget(script, request);
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Wave23 target arguments missing");
try { writeFileSync(resolve(outputPath), JSON.stringify(await execute(JSON.parse(readFileSync(resolve(inputPath), "utf8"))), null, 2), "utf8"); }
catch (error) { console.error(error); process.exitCode = 1; }
