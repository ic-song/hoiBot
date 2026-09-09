import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { CanonicalItemInventoryRepository } from "../../src/inventory/canonical-item-inventory-repository.js";
import { classifyMariaDatabaseError } from "../../src/shared/maria-database-error-policy.js";

const CONSUMER_ID = "sql-repository-87ed81931dd7417b";
const NORMALIZE = (sql) => sql.replace(/\s+/g, " ").trim();
const TARGET_DML = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(canonical_owned_item_stacks|canonical_item_inventory_operations|canonical_item_inventory_ledger_entries)\b/i;
const TABLES = ["canonical_owned_item_stacks", "canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"];
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`Wave24 missing environment: ${name}`); return value; };
const canonical = (value) => typeof value === "bigint" ? value.toString() : value;
const rows = (values) => values.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonical(value)])));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const audit = ["wave24-fixture", "2026-09-09 14:00:00", "wave24-fixture", "2026-09-09 14:00:00"];

function databaseConfig() {
  const database = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: "wave24-no-iris-token", USER_VERIFICATION_PEPPER: "wave24-no-user-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") }).database;
  if (database.host !== "127.0.0.1" || database.port === 3306 || !database.name.startsWith("hoibot_wave24_item_stack_quantity_")) throw new Error("Wave24 database isolation rejected");
  return database;
}

function classifiedFailure(error) {
  let candidate = error;
  for (let depth = 0; depth < 5 && candidate; depth += 1) {
    const found = classifyMariaDatabaseError(candidate);
    if (found.kind !== "OTHER") return { code: found.code ?? null, errno: found.errno ?? null, errorKind: found.kind, constraintName: found.constraintName ?? null };
    candidate = typeof candidate === "object" && "cause" in candidate ? candidate.cause : undefined;
  }
  return error instanceof Error ? { code: error.message, errno: null, errorKind: "OTHER", constraintName: null } : null;
}

function stableRows(exactRows) {
  return Object.fromEntries(Object.entries(exactRows).map(([table, values]) => [table, values.map((row) => {
    const stable = { ...row };
    if ("owned_item_stack_id" in stable) stable.owned_item_stack_id = "STACK_ID";
    if ("item_inventory_operation_id" in stable) stable.item_inventory_operation_id = "OPERATION_ID";
    if ("item_inventory_ledger_entry_id" in stable) stable.item_inventory_ledger_entry_id = "LEDGER_ID";
    return stable;
  })]));
}

function traced(database, rollbackOnly = false) {
  const attempts = [];
  let shadowResult = null;
  const root = async (work) => {
    const attempt = { number: attempts.length + 1, outcome: "ROLLBACK", lockOrder: [], targetDml: [], targetAffectedRows: 0, failure: null };
    attempts.push(attempt);
    try {
      const result = await database.withTransaction(async (transaction) => {
        const value = await work({
          query: async (sql, values = []) => {
            const normalized = NORMALIZE(sql);
            if (/\bFOR UPDATE\b/i.test(normalized)) for (const match of normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) if (!attempt.lockOrder.includes(match[1])) attempt.lockOrder.push(match[1]);
            return transaction.query(sql, values);
          },
          execute: async (sql, values = []) => {
            const normalized = NORMALIZE(sql), target = TARGET_DML.test(normalized);
            if (target) attempt.targetDml.push(normalized);
            const result = await transaction.execute(sql, values);
            if (target) attempt.targetAffectedRows += Number(result.affectedRows);
            return result;
          },
        });
        if (rollbackOnly) { shadowResult = value; throw new Error("WAVE24_SHADOW_ROLLBACK"); }
        return value;
      });
      attempt.outcome = "COMMIT";
      return result;
    } catch (error) {
      attempt.failure = classifiedFailure(error);
      throw error;
    }
  };
  return { attempts, shadowResult: () => shadowResult, client: { ping: () => database.ping(), verifyRollback: () => database.verifyRollback(), query: (sql, values = []) => database.query(sql, values), execute: (sql, values = []) => database.execute(sql, values), withTransaction: root, withRootTransaction: root, close: async () => undefined } };
}

async function itemRows(database) {
  return stableRows({
    canonical_owned_item_stacks: rows(await database.query("SELECT owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_owned_item_stacks ORDER BY player_id,item_id")),
    canonical_item_inventory_operations: rows(await database.query("SELECT item_inventory_operation_id,player_id,request_key,operation_status,resulting_quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_item_inventory_operations ORDER BY player_id,request_key")),
    canonical_item_inventory_ledger_entries: rows(await database.query("SELECT item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_item_inventory_ledger_entries ORDER BY player_id,item_inventory_ledger_entry_id")),
  });
}

async function reset(database) {
  await database.execute("DROP TRIGGER IF EXISTS wave24_fail_item_ledger");
  await database.execute("DELETE FROM canonical_item_inventory_ledger_orderings");
  await database.execute("DELETE FROM canonical_item_inventory_ledger_heads");
  await database.execute("DELETE FROM canonical_item_inventory_ledger_entries");
  await database.execute("DELETE FROM canonical_item_inventory_operations");
  await database.execute("DELETE FROM canonical_owned_item_stacks");
  await database.execute("DELETE FROM canonical_item_definitions WHERE item_id='item0001'");
  await database.execute("DELETE FROM canonical_players WHERE player_id='player01'");
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('player01','WAVE24','item-player',?,?,?,?)", audit);
  await database.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('item0001','Wave24 합성 아이템','SYNTHETIC',TRUE,TRUE,?,?,?,?)", audit);
}

async function executeMutation(request) {
  const config = databaseConfig(), database = createDatabaseClient(config);
  try {
    if (request.consumerId !== CONSUMER_ID) throw new Error(`Wave24 unknown consumer: ${request.consumerId}`);
    if (request.mode === "RESET") { await reset(database); return { reset: true, processId: process.pid }; }
    if (request.mode === "FAIL_REPLAY") { await database.execute("CREATE TRIGGER wave24_fail_item_ledger BEFORE INSERT ON canonical_item_inventory_ledger_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WAVE24 forced item ledger failure'"); return { seeded: true, processId: process.pid }; }
    const beforeRows = await itemRows(database), trace = traced(database, request.mode === "SHADOW"), requestKey = `request-${request.scenario}`;
    const input = { actor: "wave24-fixture", playerId: "player01", itemId: "item0001", requestKey, quantityDelta: BigInt(request.quantity ?? 3), reasonType: request.drift ? "USE" : "REWARD" };
    let replayed = null, result = null, errorCode = null;
    try { result = await new CanonicalItemInventoryRepository(trace.client, undefined, undefined, () => new Date("2026-09-09T05:00:00.000Z")).changeStackQuantity(input); replayed = result.replayed; }
    catch (error) { errorCode = error instanceof Error ? error.message : String(error); }
    const afterRows = await itemRows(database), committed = trace.attempts.filter((attempt) => attempt.outcome === "COMMIT"), rolledBack = trace.attempts.filter((attempt) => attempt.outcome === "ROLLBACK");
    const locatorRows = stableRows({ locator: rows(await database.query("SELECT operation.item_inventory_operation_id,operation.player_id,operation.request_key,operation.operation_status,operation.resulting_quantity,ledger.item_inventory_ledger_entry_id,ledger.item_id,ledger.quantity_delta,ledger.reason_type,stack.owned_item_stack_id,stack.quantity FROM canonical_item_inventory_operations operation JOIN canonical_item_inventory_ledger_entries ledger ON ledger.item_inventory_operation_id=operation.item_inventory_operation_id JOIN canonical_owned_item_stacks stack ON stack.owned_item_stack_id=ledger.owned_item_stack_id WHERE operation.player_id=? AND operation.request_key=?", [input.playerId, input.requestKey])) }).locator;
    return { processId: process.pid, moduleExecutionId: randomUUID(), scenario: request.scenario, database: { host: config.host, port: config.port, name: config.name }, attempts: trace.attempts, committedDml: committed.flatMap((attempt) => attempt.targetDml), committedRows: committed.reduce((sum, attempt) => sum + attempt.targetAffectedRows, 0), rolledBackAffectedRows: rolledBack.reduce((sum, attempt) => sum + attempt.targetAffectedRows, 0), replayed, errorCode, result: result === null ? trace.shadowResult() : result, beforeRows, afterRows, beforeSha256: hash(beforeRows), afterSha256: hash(afterRows), locatorProjection: { mode: "RAW_COMPOSITE", key: { player_id: input.playerId, request_key: input.requestKey }, rows: locatorRows, locatorOK: locatorRows.every((row) => row.player_id === input.playerId && row.request_key === input.requestKey) }, externalNetworkCalls: 0, replyCalls: 0 };
  } finally { await database.close(); }
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Wave24 target arguments missing");
try { const output = await executeMutation(JSON.parse(readFileSync(resolve(inputPath), "utf8"))); writeFileSync(resolve(outputPath), JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2), "utf8"); }
catch (error) { console.error(error); process.exitCode = 1; }
