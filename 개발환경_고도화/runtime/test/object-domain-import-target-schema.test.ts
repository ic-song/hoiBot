import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface FieldMap {
  mappings: Array<{ targetTables: string[] }>;
}

interface StandardColumn { name: string; }
interface StandardTable { table: string; columns: StandardColumn[]; }
interface ObjectDataModelStandard {
  registeredMigrations: string[];
  tables: StandardTable[];
}

interface TargetColumn {
  table: string;
  column: string;
  sqlType: string;
  nullable: boolean;
  migration: string;
}

interface TargetSchemaContract {
  catalogVersion: string;
  format: string;
  derivedTablesExcluded: string[];
  auditColumnsExcluded: string[];
  tableCount: number;
  columnCount: number;
  columns: TargetColumn[];
}

const fieldMap = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-field-map.v1.json", import.meta.url), "utf8")) as FieldMap;
const standard = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as ObjectDataModelStandard;
const targetSchema = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url), "utf8")) as TargetSchemaContract;
const auditColumns = new Set(["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function migrationSql(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function tableBody(sql: string, table: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${escapeRegex(table)}\\s*\\(([\\s\\S]*?)\\) ENGINE`, "i"));
  assert.ok(match, `CREATE TABLE body missing: ${table}`);
  const body = match[1];
  assert.ok(body, `CREATE TABLE body empty: ${table}`);
  return body;
}

function sqlDeclaration(body: string, table: string, column: string): { sqlType: string; nullable: boolean } {
  const match = body.match(new RegExp(
    `(?:^|\\n)\\s*${escapeRegex(column)}\\s+([A-Z]+(?:\\([^\\r\\n]+?\\))?(?:\\s+UNSIGNED)?)(?:\\s+CHARACTER SET\\s+\\w+)?(?:\\s+COLLATE\\s+\\w+)?\\s+(NOT NULL|NULL)\\b`,
    "i"
  ));
  assert.ok(match, `SQL column declaration missing: ${table}.${column}`);
  const sqlType = match[1];
  const nullability = match[2];
  assert.ok(sqlType && nullability, `SQL column declaration incomplete: ${table}.${column}`);
  return {
    sqlType: sqlType.toUpperCase().replace(/\s+/g, " "),
    nullable: nullability.toUpperCase() === "NULL"
  };
}

function alterStatements(sql: string, table: string): string[] {
  return [...sql.matchAll(new RegExp(`ALTER TABLE\\s+${escapeRegex(table)}\\s+[\\s\\S]*?;`, "gi"))]
    .map((match) => match[0]);
}

function addsColumn(sql: string, table: string, column: string): boolean {
  return alterStatements(sql, table).some((statement) =>
    new RegExp(`ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+${escapeRegex(column)}\\b`, "i").test(statement)
  );
}

function finalMigrationDeclaration(sql: string, table: string, column: string): { sqlType: string; nullable: boolean } {
  const declarations = alterStatements(sql, table).flatMap((statement) => {
    const match = statement.match(new RegExp(
      `(?:ADD|MODIFY) COLUMN(?:\\s+IF NOT EXISTS)?\\s+${escapeRegex(column)}\\s+([A-Z]+(?:\\([^\\r\\n]+?\\))?(?:\\s+UNSIGNED)?)(?:\\s+CHARACTER SET\\s+\\w+)?(?:\\s+COLLATE\\s+\\w+)?\\s+(NOT NULL|NULL)\\b`,
      "i"
    ));
    if (!match) return [];
    const sqlType = match[1];
    const nullability = match[2];
    assert.ok(sqlType && nullability, `ALTER column declaration incomplete: ${table}.${column}`);
    return [{ sqlType: sqlType.toUpperCase().replace(/\\s+/g, " "), nullable: nullability.toUpperCase() === "NULL" }];
  });
  const finalDeclaration = declarations.at(-1);
  if (finalDeclaration) return finalDeclaration;
  return sqlDeclaration(tableBody(sql, table), table, column);
}

describe("object domain import target schema contract", () => {
  it("matches exactly the 45 direct field-map targets and excludes the derived active-listing table", () => {
    const expected = [...new Set(fieldMap.mappings.flatMap((mapping) => mapping.targetTables))]
      .filter((table) => table !== "object_furniture_active_market_listings")
      .sort();
    const actual = [...new Set(targetSchema.columns.map((entry) => entry.table))].sort();

    assert.equal(expected.length, 45);
    assert.equal(targetSchema.tableCount, 45);
    assert.deepEqual(actual, expected);
    assert.deepEqual(targetSchema.derivedTablesExcluded, ["object_furniture_active_market_listings"]);
    assert.ok(!actual.includes("object_furniture_active_market_listings"));
  });

  it("contains every and only non-audit manifest column once", () => {
    const targetTables = new Set(targetSchema.columns.map((entry) => entry.table));
    const expected = standard.tables
      .filter((table) => targetTables.has(table.table))
      .flatMap((table) => table.columns
        .filter((column) => !auditColumns.has(column.name))
        .map((column) => `${table.table}.${column.name}`))
      .sort();
    const actual = targetSchema.columns.map((entry) => `${entry.table}.${entry.column}`).sort();

    assert.equal(new Set(actual).size, actual.length, "duplicate target column contract entry");
    assert.equal(targetSchema.columnCount, actual.length);
    assert.deepEqual(actual, expected);
    assert.deepEqual(new Set(targetSchema.auditColumnsExcluded), auditColumns);
    for (const entry of targetSchema.columns) assert.ok(!auditColumns.has(entry.column), `${entry.table}.${entry.column}`);
  });

  it("matches each owning migration and its exact SQL type and nullability", () => {
    const sqlByMigration = new Map(standard.registeredMigrations.map((name) => [name, migrationSql(name)]));

    for (const entry of targetSchema.columns) {
      assert.ok(standard.registeredMigrations.includes(entry.migration), entry.migration);
      const owners = [...sqlByMigration.entries()].filter(([, sql]) => {
        if (addsColumn(sql, entry.table, entry.column)) return true;
        const create = sql.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${escapeRegex(entry.table)}\\s*\\(([\\s\\S]*?)\\) ENGINE`, "i"));
        return create ? new RegExp(`(?:^|\\n)\\s*${escapeRegex(entry.column)}\\s+`, "i").test(create[1] ?? "") : false;
      });
      assert.equal(owners.length, 1, `migration owner count: ${entry.table}.${entry.column}`);
      const owner = owners[0];
      assert.ok(owner, `migration owner missing: ${entry.table}.${entry.column}`);
      assert.equal(entry.migration, owner[0], `migration owner mismatch: ${entry.table}.${entry.column}`);
      assert.deepEqual(finalMigrationDeclaration(owner[1], entry.table, entry.column), {
        sqlType: entry.sqlType,
        nullable: entry.nullable
      }, `${entry.table}.${entry.column}`);
    }
  });
});
