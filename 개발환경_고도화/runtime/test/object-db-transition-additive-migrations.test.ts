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
  tables: Array<{ table: string; checks?: Array<{ constraint: string; expression: string }> }>;
};
const migrationSources = new Map(plan.migrationFiles.map((name) => [name, readFileSync(new URL(name, migrationRoot), "utf8")]));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedColumn(column: Column): string {
  const characterStorage = column.charset === undefined ? "" : ` CHARACTER SET ${column.charset} COLLATE ${column.collation}`;
  return `${column.name} ${column.type}${characterStorage} ${column.nullable ? "NULL" : "NOT NULL"}`;
}

function sourceFor(table: string): string {
  const matches = [...migrationSources.values()].filter((source) => new RegExp(`^CREATE TABLE IF NOT EXISTS ${escapeRegExp(table)} \\(`, "m").test(source));
  assert.equal(matches.length, 1, `${table}: exactly one migration owner`);
  return matches[0]!;
}

function bodyFor(table: string): string {
  const body = new RegExp(`^CREATE TABLE IF NOT EXISTS ${escapeRegExp(table)} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, "m").exec(sourceFor(table))?.[1];
  assert.ok(body, `${table}: CREATE TABLE body`);
  return body;
}

function splitColumns(value: string): string[] {
  return value.split(", ");
}

function parseTableBody(body: string): ParsedTableBody {
  const parsed: ParsedTableBody = { columns: [], primaryKeys: [], uniqueKeys: [], foreignKeys: [], checks: [] };
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    if (line.length === 0) continue;
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
  const checks = [
    `INSERT_TIME REGEXP '${plan.globalPolicies.audit.kstRegexp}'`,
    `UPDATE_TIME REGEXP '${plan.globalPolicies.audit.kstRegexp}'`
  ];
  if (table.kind === "OPERATION_RECEIPT") checks.push("operation_status IN ('COMPLETED','FAILED')");
  checks.push(...(table.checks ?? []).map((check) => check.expression));
  return checks;
}

function assertExactTableParity(table: Table, body: string): void {
  const parsed = parseTableBody(body);
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

  it("keeps typed-ledger plan and standard-manifest checks exactly synchronized", () => {
    for (const tableName of ["canonical_market_transfer_ledger_entries", "canonical_package_use_reward_ledger_entries"]) {
      const planned = plan.tables.find((table) => table.table === tableName);
      const registered = standardManifest.tables.find((table) => table.table === tableName);
      assert.ok(planned, `${tableName}: plan`);
      assert.ok(registered, `${tableName}: manifest`);
      assert.deepEqual(registered.checks, planned.checks, `${tableName}: checks`);
    }
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
});
