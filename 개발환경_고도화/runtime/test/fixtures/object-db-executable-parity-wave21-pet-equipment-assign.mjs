import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCanonicalPetEquipmentRepository } from "../../src/pet/maria-canonical-pet-equipment-repository.js";

const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const DML = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+/i;
const TABLES = ["object_identities", "object_identity_crosswalks", "canonical_owned_pet_equipment", "canonical_pet_equipment_operation_replays"];
const ZERO = Object.freeze(Object.fromEntries(TABLES.map((table) => [table, 0])));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Wave21 missing environment: ${name}`);
  return value;
}

function config() {
  const result = loadConfig({
    NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wave21-no-iris-token",
    USER_VERIFICATION_PEPPER: "wave21-no-user-pepper", DATABASE_ENABLED: "true",
    DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
    DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
    DATABASE_NAME: required("DATABASE_NAME"),
  });
  if (result.database.host !== "127.0.0.1" || result.database.port === 3306 || !result.database.name.startsWith("hoibot_wave21_pet_equipment_assign")) throw new Error("Wave21 database isolation rejected");
  return result.database;
}

async function reset(database) {
  await database.execute("DELETE FROM canonical_pet_equipment_operation_replays");
  await database.execute("DELETE FROM canonical_owned_pet_equipment");
  await database.execute("DELETE FROM object_identity_crosswalks");
  await database.execute("DELETE FROM object_identities");
  for (const table of ["canonical_owned_equipment_instances", "canonical_equipment_definitions", "canonical_owned_pet_instances", "canonical_pet_definitions", "canonical_players"]) await database.execute(`DELETE FROM ${table}`);
}

async function seedDomain(database) {
  const audit = ["wave21-fixture", "2026-09-09 04:00:00", "wave21-fixture", "2026-09-09 04:00:00"];
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('player01','WAVE21','player',?,?,?,?)", audit);
  await database.execute("INSERT INTO canonical_pet_definitions(pet_id,pet_name,pet_description,pet_grade,base_charm,charm_per_enhancement,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('petdef01','합성 펫',NULL,NULL,0,0,TRUE,?,?,?,?)", audit);
  await database.execute("INSERT INTO canonical_owned_pet_instances(owned_pet_id,player_id,pet_id,custom_name,enhancement_level,experience_amount,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ownedp01','player01','petdef01',NULL,0,0,'owned',?,?,?,?)", audit);
  for (const [definitionId, ownedId, name] of [["equip001", "ownede01", "합성 펜던트 1"], ["equip002", "ownede02", "합성 펜던트 2"]]) {
    await database.execute("INSERT INTO canonical_equipment_definitions(equipment_id,equipment_name,equipment_description,equipment_slot,equipment_grade,base_charm,charm_per_enhancement,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,NULL,'pendant',NULL,0,0,TRUE,?,?,?,?)", [definitionId, name, ...audit]);
    await database.execute("INSERT INTO canonical_owned_equipment_instances(owned_equipment_id,player_id,equipment_id,custom_name,enhancement_level,durability_amount,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'player01',?,NULL,0,NULL,'owned',?,?,?,?)", [ownedId, definitionId, ...audit]);
  }
}

async function seedConflictingSlot(database) {
  await database.execute("INSERT INTO canonical_owned_pet_equipment(owned_pet_equipment_id,owned_pet_id,owned_equipment_id,player_id,equipment_slot,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('seedas01','ownedp01','ownede01','player01','pendant','wave21-fixture','2026-09-09 04:00:00','wave21-fixture','2026-09-09 04:00:00')");
}

async function snapshot(database) {
  const result = { ...ZERO };
  for (const table of TABLES) {
    const rows = await database.query(`SELECT COUNT(*) AS count FROM ${table}`);
    result[table] = Number(rows[0].count);
  }
  return result;
}

function scenarioInput(scenarioKey, drift = false, domainFailure = false) {
  const longRequest = scenarioKey === "failure" || scenarioKey === "drift";
  return {
    actor: "wave21-fixture", playerId: "player01", ownedPetId: "ownedp01",
    ownedEquipmentId: drift || domainFailure ? "ownede02" : "ownede01",
    equipmentSlot: "pendant", requestKey: longRequest ? `w${scenarioKey.slice(0, 4)}${"r".repeat(178)}` : `request-${scenarioKey}`,
  };
}

function traced(database) {
  const attempts = [];
  const locks = [];
  const root = async (work) => {
    const record = { attempt: attempts.length + 1, outcome: "ROLLBACK", attemptedDmlStatements: [], affectedDmlStatements: [], affectedRowCount: 0 };
    attempts.push(record);
    try {
      const result = await database.withTransaction(async (transaction) => work({
        query: async (sql, values = []) => {
          const normalized = NORMALIZE(sql);
          if (/\bFOR UPDATE\b/i.test(normalized)) {
            for (const match of normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) {
              const table = match[1];
              if (!locks.includes(table)) locks.push(table);
            }
          }
          return transaction.query(sql, values);
        },
        execute: async (sql, values = []) => {
          const normalized = NORMALIZE(sql);
          const dml = DML.test(normalized);
          if (dml) record.attemptedDmlStatements.push(normalized);
          const result = await transaction.execute(sql, values);
          if (dml) {
            record.affectedDmlStatements.push(normalized);
            record.affectedRowCount += Number(result.affectedRows);
          }
          return result;
        },
      }));
      record.outcome = "COMMIT";
      return result;
    } catch (error) {
      record.outcome = "ROLLBACK";
      throw error;
    }
  };
  return {
    attempts,
    locks,
    client: {
      ping: () => database.ping(), verifyRollback: () => database.verifyRollback(),
      query: (sql, values = []) => database.query(sql, values), execute: (sql, values = []) => database.execute(sql, values),
      withTransaction: root, withRootTransaction: root, close: async () => undefined,
    },
  };
}

function stableHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function errorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("REQUEST_PAYLOAD_CONFLICT")) return "CANONICAL_PET_EQUIPMENT_REQUEST_PAYLOAD_CONFLICT";
  if (error && typeof error === "object" && error.code === "ER_DUP_ENTRY" && error.errno === 1062) return `MARIADB_1062_${String(error.sqlMessage ?? message).match(/for key ['`\"]([^'`\"]+)['`\"]/i)?.[1]?.toUpperCase() ?? "UNKNOWN"}`;
  return message;
}

async function execute(request) {
  const databaseConfig = config();
  const database = createDatabaseClient(databaseConfig);
  try {
    if (request.mode === "RESET") {
      await reset(database); await seedDomain(database);
      return { reset: true, processId: process.pid };
    }
    if (request.domainFailure === true) await seedConflictingSlot(database);
    const before = await snapshot(database);
    const trace = traced(database);
    const callInput = scenarioInput(request.scenarioKey, request.drift === true, request.domainFailure === true);
    let replayed = null;
    let failure = null;
    try {
      const result = await new MariaCanonicalPetEquipmentRepository(trace.client).assign(callInput);
      replayed = result.replayed;
    } catch (error) {
      failure = errorCode(error);
    }
    const after = await snapshot(database);
    const committed = trace.attempts.filter(({ outcome }) => outcome === "COMMIT");
    const rolledBack = trace.attempts.filter(({ outcome }) => outcome === "ROLLBACK");
    const rawLocator = `${callInput.playerId}:${callInput.requestKey}`;
    return {
      processId: process.pid, moduleExecutionId: randomUUID(), role: request.role,
      source: request.source, database: { host: databaseConfig.host, port: databaseConfig.port, name: databaseConfig.name },
      transactionAttempts: trace.attempts,
      committedDmlStatements: committed.flatMap(({ affectedDmlStatements }) => affectedDmlStatements),
      committedRowCount: committed.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0),
      rolledBackAffectedRowCount: rolledBack.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0),
      lockOrder: trace.locks, before, after, replayed, errorCode: failure, externalNetworkCalls: 0, replyCalls: 0,
      locatorMode: rawLocator.length <= 191 ? "LEGACY_RAW" : "SHA256_OVERFLOW",
      beforeSha256: stableHash(before), afterSha256: stableHash(after),
    };
  } finally {
    await database.close();
  }
}

const [inputPath, outputPath] = process.argv.slice(2);
if (inputPath && outputPath) {
  const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  try { writeFileSync(resolve(outputPath), JSON.stringify(await execute(request)), "utf8"); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

export { execute as executeWave21PetEquipmentAssign };
