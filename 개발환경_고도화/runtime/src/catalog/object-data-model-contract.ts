export const OBJECT_DATA_MODEL_STANDARD_VERSION = "object-data-model-standard.v1" as const;

export const REQUIRED_AUDIT_COLUMNS = ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"] as const;
const OWNERSHIP_COMMON_COLUMNS = new Set(["player_id", "quantity", ...REQUIRED_AUDIT_COLUMNS]);
// 오브젝트 자체 식별용 CODE는 금지하되, 경계·결과를 설명하는 제한된 의미 코드만 허용합니다.
const SEMANTIC_CODE_COLUMN_ALLOWLIST = new Set([
  "command_code",
  "environment_code",
  "error_code",
  "event_code",
  "provider_code",
  "reason_code",
  "recovery_code",
]);
const INTEGRATION_DEPENDENCY_REGISTRY: Readonly<Record<string, { migration: string; primaryKey: readonly string[]; requiredUniqueKeys: readonly (readonly string[])[] }>> = {
  canonical_players: { migration: "444_canonical_item_inventory.sql", primaryKey: ["player_id"], requiredUniqueKeys: [] },
  canonical_owned_pet_instances: { migration: "446_canonical_pet_equipment.sql", primaryKey: ["owned_pet_id"], requiredUniqueKeys: [["owned_pet_id", "player_id"]] },
  canonical_currency_definitions: { migration: "452_canonical_currency_ledger.sql", primaryKey: ["currency_id"], requiredUniqueKeys: [] },
  canonical_player_currency_balances: { migration: "452_canonical_currency_ledger.sql", primaryKey: ["player_currency_balance_id"], requiredUniqueKeys: [["player_id", "currency_id"], ["player_currency_balance_id", "player_id", "currency_id"]] },
};
const EXTERNAL_DEPENDENCY_REGISTRY: Readonly<Record<string, ObjectDataModelExternalDependency>> = {
  external_identities: {
    table: "external_identities",
    integrationMigration: "003_identity_import.sql",
    columns: [
      { name: "id", type: "BIGINT UNSIGNED" },
      { name: "provider_code", type: "VARCHAR(64)", charset: "ascii", collation: "ascii_bin" },
      { name: "external_user_id", type: "VARCHAR(191)", charset: "utf8mb4", collation: "utf8mb4_bin" },
    ],
    primaryKey: ["id"],
    uniqueKeys: [["provider_code", "external_user_id"]],
  },
};

export type ObjectTableRole = "identity" | "definition" | "ownership_quantity" | "ownership_instance" | "relation" | "history" | "operation";

export interface ObjectDataModelColumn { name: string; type: string; charset?: string; collation?: string; }
export interface ObjectDataModelForeignKey {
  referencesTable: string;
  column?: string;
  referencesColumn?: string;
  columns?: readonly string[];
  referencesColumns?: readonly string[];
}
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
export interface ObjectDataModelExternalDependency {
  table: string;
  integrationMigration: string;
  columns: readonly ObjectDataModelColumn[];
  primaryKey: readonly string[];
  uniqueKeys: readonly (readonly string[])[];
}
export interface ObjectDataModelContract {
  standardVersion: typeof OBJECT_DATA_MODEL_STANDARD_VERSION;
  scope: "new_object_schema_only";
  registeredMigrations: readonly string[];
  tables: readonly ObjectDataModelTable[];
  // 현재 branch에 없는 선행 migration table은 정확한 migration과 shape를 고정해 FK 대상으로만 사용합니다.
  integrationOnlyTables?: readonly ObjectDataModelIntegrationTable[];
  // 레거시 schema FK 대상은 pinned 최소 shape와 후보키만 제공하며 object table 검증 대상에는 포함하지 않습니다.
  externalDependencies?: readonly ObjectDataModelExternalDependency[];
  // handler_key/options_json은 안전한 데이터이며 이 목록의 실행 payload 컬럼은 허용하지 않습니다.
  forbiddenExecutableColumns: readonly string[];
}

function fail(code: string, message: string): never { throw new Error(`OBJECT_DATA_MODEL_${code}:${message}`); }
function column(table: Pick<ObjectDataModelTable, "table" | "columns">, name: string): ObjectDataModelColumn {
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
function sameColumnNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}
function validateCandidateKeys(table: ObjectDataModelTable): void {
  for (const [kind, keys] of [["PRIMARY", [table.primaryKey]], ["UNIQUE", table.uniqueKeys ?? []]] as const) {
    for (const key of keys) {
      if (key.length === 0) fail(`${kind}_KEY_EMPTY`, table.table);
      if (new Set(key).size !== key.length) fail(`${kind}_KEY_DUPLICATE`, `${table.table}.${key.join(",")}`);
      for (const name of key) column(table, name);
    }
  }
}
function sameColumns(left: readonly ObjectDataModelColumn[], right: readonly ObjectDataModelColumn[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const candidate = right[index];
    return candidate !== undefined && entry.name === candidate.name && sameColumnShape(entry, candidate);
  });
}
function sameKeys(left: readonly (readonly string[])[], right: readonly (readonly string[])[]): boolean {
  return left.length === right.length && left.every((key, index) => sameColumnNames(key, right[index] ?? []));
}
function foreignKeyColumns(table: ObjectDataModelTable, foreignKey: ObjectDataModelForeignKey): { columns: readonly string[]; referencesColumns: readonly string[] } {
  const scalarDeclared = foreignKey.column !== undefined || foreignKey.referencesColumn !== undefined;
  const compositeDeclared = foreignKey.columns !== undefined || foreignKey.referencesColumns !== undefined;
  if (scalarDeclared === compositeDeclared) fail("FK_DECLARATION", `${table.table}->${foreignKey.referencesTable}`);
  const columns = scalarDeclared
    ? foreignKey.column !== undefined && foreignKey.referencesColumn !== undefined ? [foreignKey.column] : []
    : foreignKey.columns ?? [];
  const referencesColumns = scalarDeclared
    ? foreignKey.column !== undefined && foreignKey.referencesColumn !== undefined ? [foreignKey.referencesColumn] : []
    : foreignKey.referencesColumns ?? [];
  if (columns.length === 0 || referencesColumns.length === 0) fail("FK_DECLARATION", `${table.table}->${foreignKey.referencesTable}`);
  if (columns.length !== referencesColumns.length) fail("FK_ARITY", `${table.table}->${foreignKey.referencesTable}`);
  if (new Set(columns).size !== columns.length || new Set(referencesColumns).size !== referencesColumns.length) fail("FK_COLUMN_DUPLICATE", `${table.table}->${foreignKey.referencesTable}`);
  return { columns, referencesColumns };
}
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
  const externalDependencies = new Map<string, ObjectDataModelExternalDependency>();
  for (const table of contract.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.table)) fail("TABLE_NAME", table.table);
    if (tables.has(table.table)) fail("TABLE_DUPLICATE", table.table);
    if (table.primaryKey.length === 0) fail("PRIMARY_KEY_EMPTY", table.table);
    const names = table.columns.map((entry) => entry.name);
    if (new Set(names).size !== names.length) fail("COLUMN_DUPLICATE", table.table);
    if (table.columns.some((entry) => entry.name.toLowerCase() === "id")) fail("BARE_ID", table.table);
    if (table.columns.some((entry) => /(^|_)code$/i.test(entry.name) && !SEMANTIC_CODE_COLUMN_ALLOWLIST.has(entry.name))) fail("OBJECT_CODE", table.table);
    if (table.columns.some((entry) => forbiddenPattern.test(entry.name))) fail("EXECUTABLE_PAYLOAD", table.table);
    validateAuditColumns(table);
    validateCandidateKeys(table);
    for (const primaryKey of table.primaryKey) validateIdentifier(column(table, primaryKey), `${table.table}.${primaryKey}`);
    if (table.role === "ownership_instance" && !table.primaryKey.some((name) => /^owned_.*_id$/.test(name))) fail("INSTANCE_PK", table.table);
    if (table.role === "ownership_quantity" && !(table.uniqueKeys ?? []).some((key) => key.includes("player_id") && key.some((name) => name !== "player_id" && name.endsWith("_id")))) fail("QUANTITY_UNIQUE", table.table);
    if (isOwnership(table)) {
      if (table.allowedStateColumns === undefined) fail("OWNERSHIP_BOUNDARY", table.table);
      const allowed = new Set([...OWNERSHIP_COMMON_COLUMNS, ...table.primaryKey, ...table.foreignKeys.flatMap((key) => [...foreignKeyColumns(table, key).columns]), ...table.allowedStateColumns]);
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
    validateCandidateKeys(table);
    for (const primaryKey of table.primaryKey) validateIdentifier(column(table, primaryKey), `${table.table}.${primaryKey}`);
    for (const requiredKey of dependency.requiredUniqueKeys) {
      if (!(table.uniqueKeys ?? []).some((key) => JSON.stringify(key) === JSON.stringify(requiredKey))) fail("INTEGRATION_UNIQUE_KEY_MISSING", `${table.table}.${requiredKey.join(",")}`);
      for (const keyColumn of requiredKey) validateIdentifier(column(table, keyColumn), `${table.table}.${keyColumn}`);
    }
    tables.set(table.table, table);
  }
  for (const dependency of contract.externalDependencies ?? []) {
    if (tables.has(dependency.table) || externalDependencies.has(dependency.table)) fail("EXTERNAL_DEPENDENCY_DUPLICATE", dependency.table);
    const pinned = EXTERNAL_DEPENDENCY_REGISTRY[dependency.table];
    if (pinned === undefined) fail("EXTERNAL_DEPENDENCY_NOT_PINNED", dependency.table);
    if (dependency.integrationMigration !== pinned.integrationMigration || contract.registeredMigrations.includes(dependency.integrationMigration)) fail("EXTERNAL_DEPENDENCY_MIGRATION", dependency.table);
    if (!sameColumns(dependency.columns, pinned.columns)) fail("EXTERNAL_DEPENDENCY_COLUMNS", dependency.table);
    if (!sameColumnNames(dependency.primaryKey, pinned.primaryKey) || !sameKeys(dependency.uniqueKeys, pinned.uniqueKeys)) fail("EXTERNAL_DEPENDENCY_KEYS", dependency.table);
    externalDependencies.set(dependency.table, dependency);
  }
  for (const table of contract.tables) {
    for (const foreignKey of table.foreignKeys) {
      const { columns, referencesColumns } = foreignKeyColumns(table, foreignKey);
      const target = tables.get(foreignKey.referencesTable) ?? externalDependencies.get(foreignKey.referencesTable);
      if (target === undefined) fail("FK_TARGET", `${table.table}.${columns.join(",")}`);
      if (!sameColumnNames(columns, referencesColumns)) fail("FK_NAME", `${table.table}.${columns.join(",")}`);
      const candidateKeys = [target.primaryKey, ...(target.uniqueKeys ?? [])];
      if (!candidateKeys.some((key) => sameColumnNames(key, referencesColumns))) fail("FK_NOT_CANDIDATE_KEY", `${table.table}.${columns.join(",")}`);
      for (let index = 0; index < columns.length; index += 1) {
        if (!sameColumnShape(column(table, columns[index]!), column(target, referencesColumns[index]!))) fail("FK_SHAPE", `${table.table}.${columns[index]}`);
      }
    }
    if (isOwnership(table)) {
      if (!table.foreignKeys.some((key) => foreignKeyColumns(table, key).columns.includes("player_id") && tables.get(key.referencesTable)?.role === "identity")) fail("OWNERSHIP_PLAYER_FK", table.table);
      if (!table.foreignKeys.some((key) => tables.get(key.referencesTable)?.role === "definition")) fail("OWNERSHIP_DEFINITION_FK", table.table);
    }
  }
}
// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER: additive schema contract, excluded from frozen legacy-provider inventories.
