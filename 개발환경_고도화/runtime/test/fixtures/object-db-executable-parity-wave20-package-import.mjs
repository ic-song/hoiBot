import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCanonicalPackageRewardRepository } from "../../src/package/canonical-package-reward-repository.js";

const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const DML = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+/i;
const TABLES = [
  "canonical_package_item_rewards", "canonical_package_nested_rewards", "canonical_package_reward_quarantines",
  "canonical_package_reward_entries", "canonical_package_reward_groups", "canonical_package_definition_replays",
  "canonical_package_definition_imports", "canonical_package_definitions", "object_identity_crosswalks", "object_identities",
];
const ZERO = Object.freeze(Object.fromEntries(TABLES.map((table) => [table, 0])));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Wave20 missing environment: ${name}`);
  return value;
}

function config() {
  const result = loadConfig({
    NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wave20-no-iris-token",
    USER_VERIFICATION_PEPPER: "wave20-no-user-pepper", DATABASE_ENABLED: "true",
    DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
    DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
    DATABASE_NAME: required("DATABASE_NAME"),
  });
  if (result.database.host !== "127.0.0.1" || result.database.port === 3306 || !result.database.name.startsWith("hoibot_wave20_package_import")) throw new Error("Wave20 database isolation rejected");
  return result.database;
}

async function reset(database) {
  for (const table of TABLES.slice(0, 9)) await database.execute(`DELETE FROM ${table}`);
  await database.execute("DELETE FROM object_identities WHERE object_identity_id NOT IN ('item0001','pack0002')");
}

async function seedTargets(database) {
  const audit = ["wave20-fixture", "2026-09-09 00:00:00", "wave20-fixture", "2026-09-09 00:00:00"];
  await database.execute("INSERT IGNORE INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('item0001','ITEM',?,?,?,?),('pack0002','PACKAGE',?,?,?,?)", [...audit, ...audit]);
  await database.execute("INSERT IGNORE INTO canonical_item_definitions(item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('item0001','합성 아이템',NULL,'material',NULL,NULL,NULL,TRUE,TRUE,NULL,?,?,?,?)", audit);
  await database.execute("INSERT IGNORE INTO canonical_package_definitions(package_id,package_name,package_description,max_open_quantity,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('pack0002','합성 중첩 패키지',NULL,1,TRUE,?,?,?,?)", audit);
}

async function snapshot(database) {
  const result = { ...ZERO };
  for (const table of TABLES) {
    const where = table === "object_identities" ? " WHERE object_identity_id NOT IN ('item0001','pack0002')" : table === "canonical_package_definitions" ? " WHERE package_id<>'pack0002'" : "";
    const rows = await database.query(`SELECT COUNT(*) AS count FROM ${table}${where}`);
    result[table] = Number(rows[0].count);
  }
  return result;
}

function input(scenarioKey, drift = false, domainFailure = false) {
  const rewards = [
    { kind: "item", sourceRewardIdentifier: "reward-001", rewardOrder: 1, itemId: "item0001", quantity: 3n, probability: "1" },
    { kind: "package", sourceRewardIdentifier: "reward-002", rewardOrder: 2, packageId: "pack0002", quantity: 1n, probability: "0.25" },
    { kind: "gap", sourceRewardIdentifier: "reward-003", rewardOrder: 3, targetKind: "item", targetSourceIdentifier: "missing-item", targetDisplayName: "미확인보상🎁(원문)", quarantineReason: "TARGET_UNMAPPED" },
  ];
  if (domainFailure) rewards.splice(1, 2, { kind: "item", sourceRewardIdentifier: "reward-002", rewardOrder: 2, itemId: "miss0001", quantity: 1n, probability: "1" });
  return {
    actor: "wave20-fixture", sourceSystem: "WAVE20", sourceNamespace: "packageImport",
    sourceIdentifier: `package-${scenarioKey}`, requestKey: `request-${scenarioKey}`,
    packageName: drift ? "변조된 패키지" : "다이아상자💎(/다이아상자오픈)",
    packageDescription: "Wave20 비식별 합성 패키지", maxOpenQuantity: 7, active: true, selectionMode: "all",
    rewards,
  };
}

function traced(database) {
  const attempts = [];
  const locks = [];
  return {
    attempts, locks,
    client: {
      ...database,
      query: (sql, values = []) => database.query(sql, values),
      execute: (sql, values = []) => database.execute(sql, values),
      withTransaction: async (work) => {
        const record = { attempt: attempts.length + 1, outcome: "ROLLBACK", attemptedDmlStatements: [], affectedDmlStatements: [], affectedRowCount: 0 };
        attempts.push(record);
        try {
          const result = await database.withTransaction(async (transaction) => work({
            query: async (sql, values = []) => {
              const normalized = NORMALIZE(sql);
              if (/\bFOR UPDATE\b/i.test(normalized)) {
                const table = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(normalized)?.[1] ?? "recursive_package_descendants";
                if (!locks.includes(table)) locks.push(table);
              }
              return transaction.query(sql, values);
            },
            execute: async (sql, values = []) => {
              const normalized = NORMALIZE(sql);
              const dml = DML.test(normalized);
              if (dml) record.attemptedDmlStatements.push(normalized);
              const result = await transaction.execute(sql, values);
              if (dml) { record.affectedDmlStatements.push(normalized); record.affectedRowCount += Number(result.affectedRows); }
              return result;
            },
          }));
          record.outcome = "COMMIT";
          return result;
        } catch (error) {
          record.outcome = "ROLLBACK";
          throw error;
        }
      },
    },
  };
}

async function execute(request) {
  const databaseConfig = config();
  const database = createDatabaseClient(databaseConfig);
  try {
    if (request.mode === "RESET") {
      await reset(database); await seedTargets(database);
      return { reset: true, processId: process.pid };
    }
    const before = await snapshot(database);
    const trace = traced(database);
    let replayed = null;
    let errorCode = null;
    try {
      const result = await new MariaCanonicalPackageRewardRepository(trace.client).importDefinition(input(request.scenarioKey, request.drift === true, request.domainFailure === true));
      replayed = result.replayed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorCode = message.includes("ITEM_TARGET_NOT_FOUND") ? "CANONICAL_PACKAGE_ITEM_TARGET_NOT_FOUND" : message.includes("REQUEST_PAYLOAD_CONFLICT") ? "CANONICAL_PACKAGE_REQUEST_PAYLOAD_CONFLICT" : message;
    }
    const after = await snapshot(database);
    const committed = trace.attempts.filter(({ outcome }) => outcome === "COMMIT");
    const rolledBack = trace.attempts.filter(({ outcome }) => outcome === "ROLLBACK");
    return {
      processId: process.pid, moduleExecutionId: randomUUID(), role: request.role,
      source: request.source, database: { host: databaseConfig.host, port: databaseConfig.port, name: databaseConfig.name },
      transactionAttempts: trace.attempts,
      committedDmlStatements: committed.flatMap(({ affectedDmlStatements }) => affectedDmlStatements),
      committedRowCount: committed.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0),
      rolledBackAffectedRowCount: rolledBack.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0),
      lockOrder: trace.locks, before, after, replayed, errorCode, externalNetworkCalls: 0, replyCalls: 0,
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

export { execute as executeWave20PackageImport };
