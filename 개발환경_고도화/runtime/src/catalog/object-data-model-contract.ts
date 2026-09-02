export const OBJECT_DATA_MODEL_STANDARD_VERSION = "object-data-model-standard.v1" as const;

export const REQUIRED_AUDIT_COLUMNS = ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"] as const;
const OWNERSHIP_COMMON_COLUMNS = new Set(["player_id", "quantity", ...REQUIRED_AUDIT_COLUMNS]);
const INTEGRATION_DEPENDENCY_REGISTRY: Readonly<Record<string, { migration: string; primaryKey: readonly string[]; requiredUniqueKeys: readonly (readonly string[])[] }>> = {
  canonical_players: { migration: "444_canonical_item_inventory.sql", primaryKey: ["player_id"], requiredUniqueKeys: [] },
  canonical_owned_pet_instances: { migration: "446_canonical_pet_equipment.sql", primaryKey: ["owned_pet_id"], requiredUniqueKeys: [["owned_pet_id", "player_id"]] },
  canonical_currency_definitions: { migration: "452_canonical_currency_ledger.sql", primaryKey: ["currency_id"], requiredUniqueKeys: [] },
  canonical_player_currency_balances: { migration: "452_canonical_currency_ledger.sql", primaryKey: ["player_currency_balance_id"], requiredUniqueKeys: [["player_id", "currency_id"], ["player_currency_balance_id", "player_id", "currency_id"]] },
};

export type ObjectTableRole = "identity" | "definition" | "ownership_quantity" | "ownership_instance" | "relation" | "history" | "operation";

export interface ObjectDataModelColumn { name: string; type: string; charset?: string; collation?: string; }
export interface ObjectDataModelForeignKey { column: string; referencesTable: string; referencesColumn: string; }
export interface ObjectDataModelTable {
  table: string;
  role: ObjectTableRole;
  columns: readonly ObjectDataModelColumn[];
  primaryKey: readonly string[];
  foreignKeys: readonly ObjectDataModelForeignKey[];
  uniqueKeys?: readonly (readonly string[])[];
  // 보유 테이블은 PK/FK/감사 컬럼 외에 이 목록의 사용자별 상태만 허용합니다.
  allowedStateColumns?: readonly string[];
  // 정의 전용값을 명시해 변경 검토 때 복제 시도를 바로 드러냅니다.
  definitionOnlyColumns?: readonly string[];
  auditTimeFormat?: "KST_YYYY-MM-DD HH:MM:SS";
}
export interface ObjectDataModelIntegrationTable extends ObjectDataModelTable { integrationMigration: string; }
export interface ObjectDataModelContract {
  standardVersion: typeof OBJECT_DATA_MODEL_STANDARD_VERSION;
  scope: "new_object_schema_only";
  registeredMigrations: readonly string[];
  tables: readonly ObjectDataModelTable[];
  // 현재 branch에 없는 선행 migration table은 정확한 migration과 shape를 고정해 FK 대상으로만 사용합니다.
  integrationOnlyTables?: readonly ObjectDataModelIntegrationTable[];
  // handler_key/options_json은 안전한 데이터이며 이 목록의 실행 payload 컬럼은 허용하지 않습니다.
  forbiddenExecutableColumns: readonly string[];
}

function fail(code: string, message: string): never { throw new Error(`OBJECT_DATA_MODEL_${code}:${message}`); }
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
  if (column(table, "INSERT_USER").type !== "VARCHAR(100)" || column(table, "UPDATE_USER").type !== "VARCHAR(100)") fail("AUDIT_USER_TYPE", table.table);
  if (column(table, "INSERT_TIME").type !== "CHAR(19)" || column(table, "UPDATE_TIME").type !== "CHAR(19)") fail("AUDIT_TIME_TYPE", table.table);
  if (table.auditTimeFormat !== "KST_YYYY-MM-DD HH:MM:SS") fail("AUDIT_TIME_FORMAT", table.table);
}
function validateIdentifier(value: ObjectDataModelColumn, location: string): void {
  if (value.type !== "CHAR(8)" || value.charset !== "ascii" || value.collation !== "ascii_bin") fail("IDENTIFIER_SHAPE", location);
}
function isOwnership(table: ObjectDataModelTable): boolean { return table.role === "ownership_quantity" || table.role === "ownership_instance"; }
function executableColumnPattern(tokens: readonly string[]): RegExp {
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|_)(?:${escaped.join("|")})(?:_|$)`, "i");
}

// 신규 표준 manifest만 검사합니다. CUID2 생성·충돌 재시도와 KST 시계 구현은 WBS731의 runtime 책임입니다.
export function validateObjectDataModelContract(contract: ObjectDataModelContract): void {
  if (contract.standardVersion !== OBJECT_DATA_MODEL_STANDARD_VERSION) fail("VERSION", String(contract.standardVersion));
  if (contract.scope !== "new_object_schema_only") fail("SCOPE", contract.scope);
  if ((contract.registeredMigrations.length === 0) !== (contract.tables.length === 0)) fail("REGISTRATION_PAIR", "registeredMigrations and tables must both be empty or populated");
  if (contract.forbiddenExecutableColumns.length === 0) fail("EXECUTABLE_POLICY", "forbiddenExecutableColumns");
  const forbiddenPattern = executableColumnPattern(contract.forbiddenExecutableColumns);
  const tables = new Map<string, ObjectDataModelTable>();
  for (const table of contract.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.table)) fail("TABLE_NAME", table.table);
    if (tables.has(table.table)) fail("TABLE_DUPLICATE", table.table);
    if (table.primaryKey.length === 0) fail("PRIMARY_KEY_EMPTY", table.table);
    if (new Set(table.primaryKey).size !== table.primaryKey.length) fail("PRIMARY_KEY_DUPLICATE", table.table);
    const names = table.columns.map((entry) => entry.name);
    if (new Set(names).size !== names.length) fail("COLUMN_DUPLICATE", table.table);
    if (table.columns.some((entry) => entry.name.toLowerCase() === "id")) fail("BARE_ID", table.table);
    if (table.columns.some((entry) => /(^|_)code$/i.test(entry.name))) fail("OBJECT_CODE", table.table);
    if (table.columns.some((entry) => forbiddenPattern.test(entry.name))) fail("EXECUTABLE_PAYLOAD", table.table);
    validateAuditColumns(table);
    for (const primaryKey of table.primaryKey) validateIdentifier(column(table, primaryKey), `${table.table}.${primaryKey}`);
    if (table.role === "ownership_instance" && !table.primaryKey.some((name) => /^owned_.*_id$/.test(name))) fail("INSTANCE_PK", table.table);
    if (table.role === "ownership_quantity" && !(table.uniqueKeys ?? []).some((key) => key.includes("player_id") && key.some((name) => name !== "player_id" && name.endsWith("_id")))) fail("QUANTITY_UNIQUE", table.table);
    if (isOwnership(table)) {
      if (table.allowedStateColumns === undefined) fail("OWNERSHIP_BOUNDARY", table.table);
      const allowed = new Set([...OWNERSHIP_COMMON_COLUMNS, ...table.primaryKey, ...table.foreignKeys.map((key) => key.column), ...table.allowedStateColumns]);
      for (const entry of table.columns) if (!allowed.has(entry.name)) fail("OWNERSHIP_COLUMN", `${table.table}.${entry.name}`);
      for (const name of table.definitionOnlyColumns ?? []) if (names.includes(name)) fail("DEFINITION_VALUE_COPIED", `${table.table}.${name}`);
    }
    tables.set(table.table, table);
  }
  for (const table of contract.integrationOnlyTables ?? []) {
    if (tables.has(table.table)) fail("INTEGRATION_TABLE_DUPLICATE", table.table);
    if (!/^[a-z][a-z0-9_]*$/.test(table.table) || table.primaryKey.length === 0) fail("INTEGRATION_TABLE_INVALID", table.table);
    if (!/^\d+_[a-z0-9_]+\.sql$/i.test(table.integrationMigration) || contract.registeredMigrations.includes(table.integrationMigration)) fail("INTEGRATION_MIGRATION_INVALID", table.table);
    const dependency = INTEGRATION_DEPENDENCY_REGISTRY[table.table];
    if (dependency === undefined || dependency.migration !== table.integrationMigration) fail("INTEGRATION_DEPENDENCY_NOT_PINNED", table.table);
    if (JSON.stringify(table.primaryKey) !== JSON.stringify(dependency.primaryKey)) fail("INTEGRATION_PRIMARY_KEY_MISMATCH", table.table);
    const names = table.columns.map((entry) => entry.name);
    if (new Set(names).size !== names.length) fail("INTEGRATION_COLUMN_DUPLICATE", table.table);
    for (const primaryKey of table.primaryKey) validateIdentifier(column(table, primaryKey), `${table.table}.${primaryKey}`);
    for (const requiredKey of dependency.requiredUniqueKeys) {
      if (!(table.uniqueKeys ?? []).some((key) => JSON.stringify(key) === JSON.stringify(requiredKey))) fail("INTEGRATION_UNIQUE_KEY_MISSING", `${table.table}.${requiredKey.join(",")}`);
      for (const keyColumn of requiredKey) validateIdentifier(column(table, keyColumn), `${table.table}.${keyColumn}`);
    }
    tables.set(table.table, table);
  }
  for (const table of contract.tables) {
    for (const foreignKey of table.foreignKeys) {
      const target = tables.get(foreignKey.referencesTable);
      if (target === undefined) fail("FK_TARGET", `${table.table}.${foreignKey.column}`);
      if (foreignKey.column !== foreignKey.referencesColumn) fail("FK_NAME", `${table.table}.${foreignKey.column}`);
      if (!target.primaryKey.includes(foreignKey.referencesColumn)) fail("FK_NOT_PRIMARY", `${table.table}.${foreignKey.column}`);
      if (!sameColumnShape(column(table, foreignKey.column), column(target, foreignKey.referencesColumn))) fail("FK_SHAPE", `${table.table}.${foreignKey.column}`);
    }
    if (isOwnership(table)) {
      if (!table.foreignKeys.some((key) => key.column === "player_id" && tables.get(key.referencesTable)?.role === "identity")) fail("OWNERSHIP_PLAYER_FK", table.table);
      if (!table.foreignKeys.some((key) => tables.get(key.referencesTable)?.role === "definition")) fail("OWNERSHIP_DEFINITION_FK", table.table);
    }
  }
}
// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER: additive schema contract, excluded from frozen legacy-provider inventories.
