import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

type Column = { name: string; type: string; nullable: boolean; charset?: string; collation?: string };
type ForeignKey = { columns: string[]; referencesTable: string; referencesColumns: string[]; onDelete: string };
type Table = {
  table: string;
  kind: string;
  columns: Column[];
  primaryKey: string[];
  uniqueKeys: string[][];
  foreignKeys: ForeignKey[];
  checks?: Array<{ constraint: string; expression: string }>;
};
type Plan = {
  migrationFiles: string[];
  amendmentMigrations: Array<{ migration: string; rollback: string; kind: string; alters: string[]; creates: string[]; inputShape: string; resultingShape: string; createOnly: boolean; reentrantDdlRequired: boolean }>;
  globalPolicies: { audit: { kstRegexp: string } };
  tables: Table[];
};

type ParsedTableBody = {
  columns: string[];
  primaryKeys: string[][];
  uniqueKeys: string[][];
  foreignKeys: Array<{ columns: string[]; referencesTable: string; referencesColumns: string[]; onDelete: string }>;
  checks: string[];
};

const migrationRoot = new URL("../migrations/", import.meta.url);
const rollbackRoot = new URL("../migrations/rollback/", import.meta.url);
const plan = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-db-consumer-additive-schema-plan.v1.json", import.meta.url), "utf8")) as Plan;
const standardManifest = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as {
  tables: Array<{ table: string; columns: Array<Omit<Column, "nullable">>; primaryKey: string[]; uniqueKeys?: string[][]; foreignKeys: Array<{ column?: string; columns?: string[]; referencesTable: string; referencesColumn?: string; referencesColumns?: string[] }>; checks?: Array<{ constraint: string; expression: string }> }>;
};
const migrationSources = new Map(plan.migrationFiles.map((name) => [name, readFileSync(new URL(name, migrationRoot), "utf8")]));
const amendmentSources = new Map(plan.amendmentMigrations.map(({ migration }) => [migration, readFileSync(new URL(migration, migrationRoot), "utf8")]));
const allSchemaSources = [...migrationSources.values(), ...amendmentSources.values()];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedColumn(column: Column): string {
  const characterStorage = column.charset === undefined ? "" : ` CHARACTER SET ${column.charset} COLLATE ${column.collation}`;
  return `${column.name} ${column.type}${characterStorage} ${column.nullable ? "NULL" : "NOT NULL"}`;
}

function sourceFor(table: string): string {
  const matches = allSchemaSources.filter((source) => new RegExp(`^CREATE TABLE IF NOT EXISTS ${escapeRegExp(table)} \\(`, "m").test(source));
  assert.equal(matches.length, 1, `${table}: exactly one migration owner`);
  return matches[0]!;
}

function bodyFor(table: string): string {
  let body = new RegExp(`^CREATE TABLE IF NOT EXISTS ${escapeRegExp(table)} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, "m").exec(sourceFor(table))?.[1];
  assert.ok(body, `${table}: CREATE TABLE body`);
  if(table==="canonical_pet_title_batch_operations"){
    const snapshot=amendmentSources.get("474_pet_title_batch_member_key_snapshot.sql");assert.ok(snapshot);
    assert.match(snapshot,/ADD COLUMN IF NOT EXISTS result_contract_version VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
    assert.match(snapshot,/result_contract_version='MEMBER_KEY_V1' AND operation_type='ADMIN_SYNC'/);
    assert.match(snapshot,/result_contract_version='RESET_V1' AND operation_type='ADMIN_RESET'/);
    body=body.replace(/^(  operation_type .*),$/m,"$1,\n  result_contract_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,")
      .replace(/^(  CONSTRAINT chk_odbt_472_01_rule_04 .*)$/m,"$1\n  CONSTRAINT chk_odbt_474_00_contract CHECK ((result_contract_version='LEGACY' AND operation_type IN ('ADMIN_SYNC','ADMIN_RESET')) OR (result_contract_version='MEMBER_KEY_V1' AND operation_type='ADMIN_SYNC') OR (result_contract_version='RESET_V1' AND operation_type='ADMIN_RESET')),");
  }
  if(table==="canonical_pet_title_batch_operation_targets"){
    const snapshot=amendmentSources.get("474_pet_title_batch_member_key_snapshot.sql");assert.ok(snapshot);
    assert.match(snapshot,/ADD COLUMN IF NOT EXISTS member_key_before VARCHAR\(255\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL/);
    assert.match(snapshot,/MODIFY COLUMN member_key_before VARCHAR\(255\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL/);
    assert.match(snapshot,/ADD CONSTRAINT IF NOT EXISTS chk_odbt_474_01_member_key CHECK \(member_key_before IS NULL OR CHAR_LENGTH\(member_key_before\) BETWEEN 1 AND 255\)/);
    assert.match(snapshot,/UPDATE_USER='migration_474'/);
    assert.match(snapshot,/UPDATE_TIME=DATE_FORMAT\(CONVERT_TZ\(UTC_TIMESTAMP\(\),'\+00:00','\+09:00'\)/);
    assert.match(snapshot,/COUNT\(DISTINCT BINARY TRIM\(identity_row\.display_name\)\)=1/);
    assert.match(snapshot,/THEN MIN\(TRIM\(identity_row\.display_name\)\)/);
    assert.match(snapshot,/COUNT\(DISTINCT BINARY TRIM\(identity_row\.display_name\)\)[\s\S]*\) > 1/);
    assert.match(snapshot,/COUNT\(DISTINCT BINARY TRIM\(identity_row\.display_name\)\)[\s\S]*\) = 0/);
    assert.match(snapshot,/PET_TITLE_BATCH_MEMBER_KEY_AMBIGUOUS/);
    assert.match(snapshot,/PET_TITLE_BATCH_MEMBER_KEY_UNRESOLVED/);
    assert.ok(snapshot.indexOf("EXECUTE migration_474_preflight_statement") < snapshot.indexOf("ALTER TABLE canonical_pet_title_batch_operation_targets"));
    assert.doesNotMatch(snapshot,/MAX\(identity_row\.display_name\)/);
    assert.doesNotMatch(snapshot,/,\s*target_row\.player_id\)\s*\nWHERE target_row\.member_key_before/);
    body=body.replace(/^(  player_id .*),$/m,"$1,\n  member_key_before VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,")
      .replace(/^(  CONSTRAINT chk_odbt_472_04_rule_03 .*)$/m,"$1\n  CONSTRAINT chk_odbt_474_01_member_key CHECK (member_key_before IS NULL OR CHAR_LENGTH(member_key_before) BETWEEN 1 AND 255),");
  }
  return body;
}

function splitColumns(value: string): string[] {
  return value.split(", ");
}

function parseTableBody(body: string): ParsedTableBody {
  const parsed: ParsedTableBody = { columns: [], primaryKeys: [], uniqueKeys: [], foreignKeys: [], checks: [] };
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    if (line.length === 0 || line.startsWith("--")) continue;
    let match = /^PRIMARY KEY \(([^)]+)\)$/.exec(line);
    if (match) {
      parsed.primaryKeys.push(splitColumns(match[1]!));
      continue;
    }
    match = /^UNIQUE KEY [a-z0-9_]+ \(([^)]+)\)$/.exec(line);
    if (match) {
      parsed.uniqueKeys.push(splitColumns(match[1]!));
      continue;
    }
    match = /^CONSTRAINT [a-z0-9_]+ FOREIGN KEY \(([^)]+)\) REFERENCES ([a-z0-9_]+) \(([^)]+)\) ON DELETE ([A-Z]+)$/.exec(line);
    if (match) {
      parsed.foreignKeys.push({ columns: splitColumns(match[1]!), referencesTable: match[2]!, referencesColumns: splitColumns(match[3]!), onDelete: match[4]! });
      continue;
    }
    match = /^CONSTRAINT [a-z0-9_]+ CHECK \((.*)\)$/.exec(line);
    if (match) {
      parsed.checks.push(match[1]!);
      continue;
    }
    assert.doesNotMatch(line, /^(?:PRIMARY KEY|UNIQUE KEY|CONSTRAINT)\b/, `unparsed table constraint: ${line}`);
    parsed.columns.push(line);
  }
  return parsed;
}

function expectedChecks(table: Table): string[] {
  const declared = (table.checks ?? []).map((check) => check.expression);
  if (declared.some((expression) => expression.startsWith("INSERT_TIME REGEXP"))) return declared;
  if (table.kind === "APP_WIRING_EVENT_CONTROL_RECEIPT") return declared;
  const checks = [
    `INSERT_TIME REGEXP '${plan.globalPolicies.audit.kstRegexp}'`,
    `UPDATE_TIME REGEXP '${plan.globalPolicies.audit.kstRegexp}'`
  ];
  if (table.kind === "OPERATION_RECEIPT") checks.push("operation_status IN ('COMPLETED','FAILED')");
  checks.push(...declared);
  return checks;
}

function applyReceiptLinkAmendment(parsed: ParsedTableBody): void {
  for(const migration of ["470_pet_explore_event_control_app_wiring.sql","472_pet_title_admin_batch_app_wiring.sql"]){
    const source=amendmentSources.get(migration);assert.ok(source);
    parsed.checks=parsed.checks.filter(expression=>!expression.includes("daily_prayer_operation_id IS NOT NULL"));
    for (const rawLine of source.split("\n")) {
    const line = rawLine.trim().replace(/[,;]$/, "");
    let match = /^ADD COLUMN IF NOT EXISTS (.+) AFTER ([a-z0-9_]+)$/.exec(line);
    if (match) {
      const afterIndex = parsed.columns.findIndex((column) => column.startsWith(`${match![2]} `));
      assert.notEqual(afterIndex, -1, `receipt amendment AFTER ${match[2]}`);
      parsed.columns.splice(afterIndex + 1, 0, match[1]!);
      continue;
    }
    match = /^ADD UNIQUE KEY IF NOT EXISTS [a-z0-9_]+ \(([^)]+)\)$/.exec(line);
    if (match) {
      const afterColumn=match[1]!;
      const predecessor=afterColumn.includes("pet_title_batch")?"pet_title_operation_id":"pet_explore_operation_id";
      const afterIndex = parsed.uniqueKeys.findIndex((key) => key[0] === predecessor);
      parsed.uniqueKeys.splice(afterIndex + 1, 0, splitColumns(match[1]!));
      continue;
    }
    match = /^ADD CONSTRAINT [a-z0-9_]+ FOREIGN KEY IF NOT EXISTS \(([^)]+)\) REFERENCES ([a-z0-9_]+) \(([^)]+)\) ON DELETE ([A-Z]+)$/.exec(line);
    if (match) {
      const predecessor=match[1]!.includes("pet_title_batch")?"pet_title_operation_id":"pet_explore_operation_id";
      const afterIndex = parsed.foreignKeys.findIndex(({ columns }) => columns[0] === predecessor);
      parsed.foreignKeys.splice(afterIndex + 1, 0, { columns: splitColumns(match[1]!), referencesTable: match[2]!, referencesColumns: splitColumns(match[3]!), onDelete: match[4]! });
      continue;
    }
    match = /^ADD CONSTRAINT (?:IF NOT EXISTS )?[a-z0-9_]+ CHECK \((.*)\)$/.exec(line);
    if (match) parsed.checks.push(match[1]!);
    }
  }
}

function applyAppWiringAmendment(parsed: ParsedTableBody): void {
  const source = amendmentSources.get("466_object_db_transition_recovery_receipt_links.sql");
  assert.ok(source);
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim().replace(/[,;]$/, "");
    let match = /^ADD COLUMN IF NOT EXISTS (.+) AFTER ([a-z0-9_]+)$/.exec(line);
    if (match) {
      const afterIndex = parsed.columns.findIndex((column) => column.startsWith(`${match![2]} `));
      assert.notEqual(afterIndex, -1, `amendment AFTER ${match[2]}`);
      parsed.columns.splice(afterIndex + 1, 0, match[1]!);
      continue;
    }
    match = /^ADD CONSTRAINT IF NOT EXISTS [a-z0-9_]+ CHECK \((.*)\)$/.exec(line);
    if (match) parsed.checks.push(match[1]!);
  }
}

function assertExactTableParity(table: Table, body: string): void {
  const parsed = parseTableBody(body);
  if (table.table === "canonical_app_wiring_operations") applyAppWiringAmendment(parsed);
  if (table.table === "canonical_app_wiring_receipt_links") applyReceiptLinkAmendment(parsed);
  assert.deepEqual(parsed.columns, table.columns.map(expectedColumn), `${table.table}: exact columns`);
  assert.deepEqual(parsed.primaryKeys, [table.primaryKey], `${table.table}: exact PK`);
  assert.deepEqual(parsed.uniqueKeys, table.uniqueKeys, `${table.table}: exact UNIQUE keys`);
  assert.deepEqual(parsed.foreignKeys, table.foreignKeys, `${table.table}: exact FKs`);
  assert.deepEqual(parsed.checks, expectedChecks(table), `${table.table}: exact CHECK expressions`);
}

describe("WBS743 Gate 2 additive transition migrations", () => {
  it("uses the next five lexically ordered migration names", () => {
    assert.deepEqual(plan.migrationFiles, plan.migrationFiles.slice().sort());
    assert.deepEqual(plan.migrationFiles.map((name) => Number(name.slice(0, 3))), [461, 462, 463, 464, 465]);
    const local = new Set(readdirSync(migrationRoot).filter((name) => /^46[1-5]_.*\.sql$/.test(name)));
    assert.deepEqual([...local].sort(), plan.migrationFiles);
  });

  it("keeps amendments 466, 470, 472, and 474 separate from the CREATE-only migration set", () => {
    assert.deepEqual(plan.amendmentMigrations.map(({ migration }) => migration), ["466_object_db_transition_recovery_receipt_links.sql", "470_pet_explore_event_control_app_wiring.sql", "472_pet_title_admin_batch_app_wiring.sql", "474_pet_title_batch_member_key_snapshot.sql"]);
    const amendment = plan.amendmentMigrations.find(({ migration }) => migration.startsWith("466_"))!;
    assert.deepEqual(amendment.alters, ["canonical_app_wiring_operations"]);
    assert.deepEqual(amendment.creates, ["canonical_app_wiring_receipt_links"]);
    assert.equal(amendment.createOnly, false);
    assert.equal(amendment.reentrantDdlRequired, true);
    const source = amendmentSources.get(amendment.migration)!;
    assert.match(source, /ALTER TABLE canonical_app_wiring_operations/);
    assert.equal([...source.matchAll(/ADD COLUMN IF NOT EXISTS /g)].length, 7);
    assert.equal([...source.matchAll(/ADD CONSTRAINT IF NOT EXISTS /g)].length, 16);
    assert.match(source, /CREATE TABLE IF NOT EXISTS canonical_app_wiring_receipt_links/);
    assert.equal(amendment.resultingShape, "MIGRATION_466_BASE_RECEIPT_LINK");
    const eventControl = plan.amendmentMigrations.find(({ migration }) => migration.startsWith("470_"))!;
    assert.deepEqual(eventControl.alters, ["canonical_app_wiring_receipt_links"]);
    assert.deepEqual(eventControl.creates, ["canonical_pet_explore_event_control_operations"]);
    assert.equal(eventControl.inputShape, amendment.resultingShape);
    assert.equal(eventControl.resultingShape, "MIGRATION_470_FINAL_RECEIPT_LINK");
    const eventSource = amendmentSources.get(eventControl.migration)!;
    assert.match(eventSource, /CREATE TABLE IF NOT EXISTS canonical_pet_explore_event_control_operations/);
    assert.match(eventSource, /ALTER TABLE canonical_app_wiring_receipt_links/);
    const petTitleBatch=plan.amendmentMigrations.find(({migration})=>migration.startsWith("472_"))!;
    assert.equal(petTitleBatch.inputShape,eventControl.resultingShape);assert.equal(petTitleBatch.resultingShape,"MIGRATION_472_FINAL_RECEIPT_LINK");
    const memberKeySnapshot=plan.amendmentMigrations.find(({migration})=>migration.startsWith("474_"))!;
    assert.equal(memberKeySnapshot.inputShape,petTitleBatch.resultingShape);assert.equal(memberKeySnapshot.resultingShape,"MIGRATION_474_REPLAY_SAFE_MEMBER_KEY_SNAPSHOT");
  });

  it("preserves the migration466 base receipt-link shape before applying migration470", () => {
    const base = parseTableBody(bodyFor("canonical_app_wiring_receipt_links"));
    assert.equal(base.columns.length, 17);
    assert.equal(base.uniqueKeys.length, 10);
    assert.equal(base.foreignKeys.length, 10);
    assert.ok(base.checks.some((expression) => expression.includes("pet_explore_operation_id IS NOT NULL") && !expression.includes("pet_explore_event_control_operation_id")));
  });

  it("materializes every proposed table with exact column, PK, unique, FK, audit and domain checks", () => {
    for (const table of plan.tables) {
      assertExactTableParity(table, bodyFor(table.table));
    }
  });

  it("rejects extra column, PK, UNIQUE, FK and CHECK drift", () => {
    const table = plan.tables.find((candidate) => candidate.table === "canonical_player_identity_crosswalks");
    assert.ok(table);
    const body = bodyFor(table.table);
    const drifts = [
      `${body}\n  unexpected_value BIGINT NULL`,
      `${body}\n  PRIMARY KEY (player_id)`,
      `${body}\n  UNIQUE KEY uq_unexpected (player_id)`,
      `${body}\n  CONSTRAINT fk_unexpected FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT`,
      `${body}\n  CONSTRAINT chk_unexpected CHECK (player_id IS NOT NULL)`
    ];
    for (const drift of drifts) assert.throws(() => assertExactTableParity(table, drift));
  });

  it("keeps migration checks and standard-manifest checks exactly synchronized", () => {
    for (const tableName of ["canonical_market_transfer_ledger_entries", "canonical_package_use_reward_ledger_entries", "canonical_pet_explore_event_control_operations", "canonical_app_wiring_receipt_links", "canonical_pet_title_global_locks", "canonical_pet_title_batch_operations", "canonical_pet_title_batch_operation_targets", "canonical_pet_title_batch_operation_participants"]) {
      const planned = plan.tables.find((table) => table.table === tableName);
      const registered = standardManifest.tables.find((table) => table.table === tableName);
      assert.ok(planned, `${tableName}: plan`);
      assert.ok(registered, `${tableName}: manifest`);
      assert.deepEqual(registered.checks, planned.checks, `${tableName}: checks`);
      assert.deepEqual(registered.columns, planned.columns.map(({ nullable: _nullable, ...column }) => column), `${tableName}: columns`);
      assert.deepEqual(registered.primaryKey, planned.primaryKey, `${tableName}: PK`);
      assert.deepEqual(registered.uniqueKeys, planned.uniqueKeys, `${tableName}: UNIQUE keys`);
      assert.deepEqual(registered.foreignKeys, planned.foreignKeys.map(({ columns, referencesTable, referencesColumns }) => columns.length === 1 ? { column: columns[0], referencesTable, referencesColumn: referencesColumns[0] } : { columns, referencesTable, referencesColumns }), `${tableName}: FKs`);
    }
    const plannedAppWiring = plan.tables.find(({ table }) => table === "canonical_app_wiring_operations");
    const registeredAppWiring = standardManifest.tables.find(({ table }) => table === "canonical_app_wiring_operations");
    assert.ok(plannedAppWiring);
    assert.ok(registeredAppWiring);
    assert.deepEqual(registeredAppWiring.checks, plannedAppWiring.checks?.slice(-16), "canonical_app_wiring_operations: amendment checks");
  });

  it("is additive and can re-enter after an unrecorded partial multi-statement run", () => {
    for (const [name, source] of migrationSources) {
      const createCount = [...source.matchAll(/CREATE TABLE IF NOT EXISTS /g)].length;
      assert.ok(createCount > 0, name);
      assert.doesNotMatch(source, /^(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/im, name);
    }
  });

  it("provides destructive pre-cutover rollbacks with exact reverse table order", () => {
    for (const migration of plan.migrationFiles) {
      const rollbackName = migration.replace(/\.sql$/, ".rollback.sql");
      const rollback = readFileSync(new URL(rollbackName, rollbackRoot), "utf8");
      assert.match(rollback, /Destructive rollback: use only before consumer cutover/);
      const forward = migrationSources.get(migration)!;
      const tables = [...forward.matchAll(/^CREATE TABLE IF NOT EXISTS ([a-z0-9_]+) /gm)].map((match) => match[1]!);
      const dropped = [...rollback.matchAll(/DROP TABLE IF EXISTS ([a-z0-9_]+);/g)].map((match) => match[1]!);
      assert.deepEqual(dropped, tables.reverse(), rollbackName);
    }
  });

  it("provides a re-entry-safe 466 rollback for the created link and altered app-wiring table", () => {
    const amendment = plan.amendmentMigrations.find(({ migration }) => migration.startsWith("466_"))!;
    const rollback = readFileSync(new URL(amendment.rollback, rollbackRoot), "utf8");
    assert.match(rollback, /DROP TABLE IF EXISTS canonical_app_wiring_receipt_links/);
    assert.match(rollback, /ALTER TABLE IF EXISTS canonical_app_wiring_operations/);
    assert.equal([...rollback.matchAll(/DROP CONSTRAINT IF EXISTS /g)].length, 16);
    assert.equal([...rollback.matchAll(/DROP COLUMN IF EXISTS /g)].length, 7);
  });

  it("provides a guarded re-entry-safe 470 rollback for the final receipt-link amendment", () => {
    const amendment = plan.amendmentMigrations.find(({ migration }) => migration.startsWith("470_"))!;
    const rollback = readFileSync(new URL(amendment.rollback, rollbackRoot), "utf8");
    assert.match(rollback, /rollback_preflight_guard/);
    assert.match(rollback, /WHERE EXISTS[\s\S]*receipt_kind = 'PET_EXPLORE_EVENT_CONTROL'/);
    assert.match(rollback, /DROP COLUMN IF EXISTS pet_explore_event_control_operation_id/);
    assert.match(rollback, /DROP TABLE IF EXISTS canonical_pet_explore_event_control_operations/);
  });

  it("provides a guarded re-entry-safe 472 rollback for exact PET_TITLE batch evidence", () => {
    const amendment = plan.amendmentMigrations.find(({ migration }) => migration.startsWith("472_"))!;
    const rollback = readFileSync(new URL(amendment.rollback, rollbackRoot), "utf8");
    assert.match(rollback, /rollback_preflight_guard/);
    assert.match(rollback, /receipt_kind='PET_TITLE_BATCH'/);
    assert.match(rollback, /canonical_pet_title_batch_operation_targets/);
    assert.match(rollback, /DROP COLUMN IF EXISTS pet_title_batch_operation_id/);
    assert.match(rollback, /DROP TABLE IF EXISTS canonical_pet_title_batch_operation_targets;[\s\S]*DROP TABLE IF EXISTS canonical_pet_title_batch_operation_participants;[\s\S]*DROP TABLE IF EXISTS canonical_pet_title_batch_operations;[\s\S]*DROP TABLE IF EXISTS canonical_pet_title_global_locks;/);
  });

  it("provides a re-entry-safe 474 rollback for the member display snapshot", () => {
    const amendment = plan.amendmentMigrations.find(({ migration }) => migration.startsWith("474_"))!;
    const rollback = readFileSync(new URL(amendment.rollback, rollbackRoot), "utf8");
    assert.match(rollback, /rollback_preflight_guard/);
    assert.match(rollback, /receipt_kind='PET_TITLE_BATCH'/);
    assert.match(rollback, /DROP CONSTRAINT IF EXISTS chk_odbt_474_01_member_key/);
    assert.match(rollback, /DROP COLUMN IF EXISTS member_key_before/);
    assert.match(rollback, /DROP CONSTRAINT IF EXISTS chk_odbt_474_00_contract/);
    assert.match(rollback, /DROP COLUMN IF EXISTS result_contract_version/);
  });
});
