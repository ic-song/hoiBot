export const OBJECT_DATA_MODEL_STANDARD_VERSION = "object-data-model-standard.v1" as const;

export const REQUIRED_AUDIT_COLUMNS = ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"] as const;
const DEFINITION_ONLY_COLUMNS = new Set([
  "item_name", "furniture_name", "pet_name", "mini_pet_name", "equipment_name", "title_name", "pet_skill_name",
  "display_name", "description", "price", "base_charm", "charm_per_enhancement", "max_enhancement_level",
  "grade", "base_stat", "effect", "common_effect"
]);

export type ObjectTableRole = "definition" | "ownership_quantity" | "ownership_instance" | "relation" | "history" | "operation";

export interface ObjectDataModelColumn {
  name: string;
  type: string;
  charset?: string;
  collation?: string;
}

export interface ObjectDataModelForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface ObjectDataModelTable {
  table: string;
  role: ObjectTableRole;
  columns: readonly ObjectDataModelColumn[];
  primaryKey: readonly string[];
  foreignKeys: readonly ObjectDataModelForeignKey[];
  uniqueKeys?: readonly (readonly string[])[];
}

export interface ObjectDataModelContract {
  standardVersion: typeof OBJECT_DATA_MODEL_STANDARD_VERSION;
  scope: "new_object_schema_only";
  registeredMigrations: readonly string[];
  tables: readonly ObjectDataModelTable[];
}

function fail(code: string, message: string): never {
  throw new Error(`OBJECT_DATA_MODEL_${code}:${message}`);
}

function column(table: ObjectDataModelTable, name: string): ObjectDataModelColumn {
  const found = table.columns.find((entry) => entry.name === name);
  if (found === undefined) fail("COLUMN_MISSING", `${table.table}.${name}`);
  return found;
}

function sameColumnShape(left: ObjectDataModelColumn, right: ObjectDataModelColumn): boolean {
  return left.type === right.type && (left.charset ?? "") === (right.charset ?? "") && (left.collation ?? "") === (right.collation ?? "");
}

function validateAuditColumns(table: ObjectDataModelTable): void {
  for (const name of REQUIRED_AUDIT_COLUMNS) column(table, name);
  if (column(table, "INSERT_TIME").type !== "CHAR(19)" || column(table, "UPDATE_TIME").type !== "CHAR(19)") {
    fail("AUDIT_TIME_TYPE", table.table);
  }
}

function validateIdentifier(columnDefinition: ObjectDataModelColumn, location: string): void {
  if (columnDefinition.type !== "CHAR(8)" || columnDefinition.charset !== "ascii" || columnDefinition.collation !== "ascii_bin") {
    fail("IDENTIFIER_SHAPE", location);
  }
}

// 신규 표준 대상 manifest만 검사하고 이미 적용된 migration을 소급 판정하지 않습니다.
export function validateObjectDataModelContract(contract: ObjectDataModelContract): void {
  if (contract.standardVersion !== OBJECT_DATA_MODEL_STANDARD_VERSION) fail("VERSION", String(contract.standardVersion));
  if (contract.scope !== "new_object_schema_only") fail("SCOPE", contract.scope);
  const tables = new Map<string, ObjectDataModelTable>();
  for (const table of contract.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.table)) fail("TABLE_NAME", table.table);
    if (tables.has(table.table)) fail("TABLE_DUPLICATE", table.table);
    if (table.columns.some((entry) => entry.name === "id")) fail("BARE_ID", table.table);
    if (table.columns.some((entry) => /(^|_)code$/.test(entry.name))) fail("OBJECT_CODE", table.table);
    validateAuditColumns(table);
    for (const primaryKey of table.primaryKey) validateIdentifier(column(table, primaryKey), `${table.table}.${primaryKey}`);
    if (table.role === "ownership_instance" && !table.primaryKey.some((name) => /^owned_.*_id$/.test(name))) {
      fail("INSTANCE_PK", table.table);
    }
    if (table.role === "ownership_quantity") {
      const uniqueKeys = table.uniqueKeys ?? [];
      if (!uniqueKeys.some((key) => key.includes("player_id") && key.some((name) => name !== "player_id" && name.endsWith("_id")))) {
        fail("QUANTITY_UNIQUE", table.table);
      }
    }
    if (table.role === "ownership_quantity" || table.role === "ownership_instance") {
      for (const entry of table.columns) {
        if (DEFINITION_ONLY_COLUMNS.has(entry.name)) fail("DEFINITION_VALUE_COPIED", `${table.table}.${entry.name}`);
      }
    }
    tables.set(table.table, table);
  }
  for (const table of contract.tables) {
    for (const foreignKey of table.foreignKeys) {
      const target = tables.get(foreignKey.referencesTable);
      if (target === undefined) fail("FK_TARGET", `${table.table}.${foreignKey.column}`);
      if (foreignKey.column !== foreignKey.referencesColumn) fail("FK_NAME", `${table.table}.${foreignKey.column}`);
      const sourceColumn = column(table, foreignKey.column);
      const targetColumn = column(target, foreignKey.referencesColumn);
      if (!sameColumnShape(sourceColumn, targetColumn)) fail("FK_SHAPE", `${table.table}.${foreignKey.column}`);
    }
  }
}
