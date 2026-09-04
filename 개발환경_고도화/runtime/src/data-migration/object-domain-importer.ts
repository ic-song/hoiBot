import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, MariaObjectIdentityAuditProvider, type ObjectAuditValues } from "../identity/object-identity-audit-provider.js";

// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER

export type DomainImportIdentityMode = "GENERATED" | "REUSED";

export interface DomainImportSchemaColumn { table: string; column: string; sqlType: string; nullable: boolean; }
export interface DomainImportGeneratedBinding { targetTable: string; targetPkColumn: string; objectType: string; sourceNamespace: string; }
export interface DomainImportReusedBinding { targetTable: string; targetPkColumn: string; sourceTable: string; sourceColumn: string; }
export interface DomainImportForeignKey { table: string; column: string; referencesTable: string; referencesColumn: string; }
export interface DomainImportPolicy {
  catalogVersion: "SC-20260902-1";
  targetSchemaSha256: string;
  importContractSha256: string;
  acceptedImportContractSha256: readonly string[];
  componentSemanticSha256: Record<"identityBindings" | "objectModel" | "disposition" | "fieldMap", string>;
  contractComponentSemanticSha256: Record<"identityBindings" | "objectModel" | "disposition" | "fieldMap", string>;
  columns: DomainImportSchemaColumn[];
  generatedBindings: DomainImportGeneratedBinding[];
  reusedBindings: DomainImportReusedBinding[];
  foreignKeys: DomainImportForeignKey[];
  directTargets: string[];
  definitionTargets: string[];
  domainTargets: Record<string, string[]>;
  quarantineReasons: string[];
}

interface ProjectionRunRow {
  catalog_projection_run_id: string; common_staging_run_id: string; catalog_version: string; projection_manifest_sha256: string;
  raw_bundle_sha256: string; snapshot_manifest_sha256: string; extraction_manifest_sha256: string;
  expected_file_count: number; expected_total_bytes: string; projected_file_count: number; ignored_file_count: number;
  target_schema_sha256: string; projection_sha256: string; upstream_envelope_sha256: string;
  expected_source_count: number; projected_source_count: number; quarantined_source_count: number;
  ignored_source_count: number; projected_row_count: number; run_status: string;
}

interface CommonStagingRunRow {
  common_staging_run_id: string; raw_bundle_sha256: string; snapshot_manifest_sha256: string;
  extraction_manifest_sha256: string; staging_sha256: string; expected_file_count: number;
  expected_total_bytes: string; projected_file_count: number; ignored_file_count: number; run_status: string;
}

interface DecisionRow {
  catalog_source_decision_id: string; source_locator_sha256: string; source_payload_fingerprint: string;
  record_domain: string; decision_status: string; decision_reason: string | null;
  projected_row_count: number; decision_fingerprint: string;
  record_kind: string; staging_projection_status: string; staging_quarantine_reason: string | null;
  staging_source_locator_sha256: string; staging_payload_fingerprint: string; staging_record_domain: string;
}

interface ProjectionRow {
  catalog_projection_record_id: string; catalog_source_decision_id: string; projection_locator: string;
  identity_locator_sha256: string; identity_mode: string; target_table_name: string;
  target_pk_column_name: string; target_object_type: string; target_source_namespace: string;
  source_role: string | null; approval_kind: string | null; approval_sha256: string | null;
  target_payload_json: string; target_payload_fingerprint: string; value_origins_json: string;
  value_origins_fingerprint: string; reference_bindings_json: string; reference_bindings_fingerprint: string;
  record_domain: string; decision_status: string;
}

interface ReferenceBinding {
  column: string; targetTable: string; targetPkColumn: string; identityLocatorSha256: string;
  bindingScope: "MANIFEST" | "APPROVED_CROSSWALK"; approvalSha256?: string;
}

interface PreparedRow extends ProjectionRow {
  payload: Record<string, unknown>;
  valueOrigins: Record<string, string>;
  references: ReferenceBinding[];
  bindingFingerprint: string;
  phase: number;
}

interface PriorRunRow {
  object_domain_import_run_id: string; catalog_projection_sha256: string; upstream_envelope_sha256: string;
  target_schema_sha256: string; import_contract_sha256: string; import_sha256: string;
  expected_source_count: number; projected_source_count: number; quarantined_source_count: number;
  ignored_source_count: number; expected_row_count: number; imported_row_count: number; run_status: string;
}

interface ReceiptRow {
  catalog_projection_record_id: string; target_table_name: string; target_pk_column_name: string;
  target_pk_value: string; identity_locator_sha256: string; import_order: number; binding_fingerprint: string; imported_row_fingerprint: string;
  projection_target_table_name?: string; projection_target_pk_column_name?: string; projection_identity_locator_sha256?: string;
}

interface DecisionReceiptRow {
  catalog_source_decision_id: string; source_locator_sha256: string; decision_status: string;
  decision_reason: string | null; projected_row_count: number; decision_fingerprint: string;
}

export interface DomainImportPlan { importSha256: string; decisions: DecisionRow[]; rows: PreparedRow[]; }
export interface DomainImportResult { objectDomainImportRunId: string; insertedCanonicalRows: number; insertedDecisionReceipts: number; replayed: boolean; }

const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_.-]+$/;
const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const AUDIT_COLUMNS = new Set(["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);
const FORBIDDEN_EXECUTABLE_KEY = /^(?:javascript|js|sql|script|handler_source|executable_payload)$/i;
const OWNERSHIP_TABLE = /(?:^canonical_owned_|^object_owned_|_selections$|_placements$|_market_listings$|_balances$)/;
const VALUE_ORIGINS = new Set(["SOURCE_EXACT", "SOURCE_ABSENT", "APPROVED_CATALOG", "EXPLICIT_RULE", "DERIVED_INDEX", "CONSTANT_CONTRACT"]);

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

// 키 순서와 입력 행 순서에 독립적인 canonical fingerprint를 생성합니다.
export function stableDomainImportJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("OBJECT_DOMAIN_IMPORT_UNSAFE_NUMBER");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableDomainImportJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableDomainImportJson(record[key])}`).join(",")}}`;
  }
  throw new Error("OBJECT_DOMAIN_IMPORT_UNSUPPORTED_VALUE");
}

export function calculateObjectDomainImportSemanticSha256(documentText: string): string {
  let document: unknown;
  try { document = JSON.parse(documentText); } catch { throw new Error("OBJECT_DOMAIN_IMPORT_CONTRACT_JSON_INVALID"); }
  return sha256(stableDomainImportJson(document));
}

export const OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION = "OBJECT_DOMAIN_IMPORT_RELEVANT_V1" as const;
export const OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256 = "487f098d9d8357bbe636b91766dd07f24618b350e449510f52f266fd2b80a861" as const;
export type ObjectDomainImportSemanticComponent = "identityBindings" | "objectModel" | "disposition" | "fieldMap";

function parseSemanticDocument(documentText: string): Record<string, unknown> {
  let document: unknown;
  try { document = JSON.parse(documentText); } catch { throw new Error("OBJECT_DOMAIN_IMPORT_CONTRACT_JSON_INVALID"); }
  if (document === null || Array.isArray(document) || typeof document !== "object") throw new Error("OBJECT_DOMAIN_IMPORT_CONTRACT_JSON_INVALID");
  return document as Record<string, unknown>;
}

// Runtime-only schema additions must not change the semantic identity of the frozen 45-table import.
export function calculateObjectDomainImportComponentSemanticSha256(component: ObjectDomainImportSemanticComponent, documentText: string, directTargets: readonly string[]): string {
  const document = parseSemanticDocument(documentText);
  let projection: unknown;
  if (component === "objectModel") {
    const tables = document.tables;
    if (!Array.isArray(tables)) throw new Error("OBJECT_DOMAIN_IMPORT_COMPONENT_PROJECTION_INVALID");
    const direct = new Set(directTargets);
    projection = {
      projectionVersion: OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION,
      component,
      tables: tables.filter((table): table is Record<string, unknown> => table !== null && !Array.isArray(table) && typeof table === "object" && direct.has(String((table as Record<string, unknown>).table)))
    };
  } else if (component === "disposition") {
    projection = {
      projectionVersion: OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION,
      component,
      definitionSeed: document.definitionSeed,
      stateImport: document.stateImport,
      initialLedger: document.initialLedger,
      quarantineOnly: document.quarantineOnly
    };
  } else {
    projection = document;
  }
  return sha256(stableDomainImportJson(projection));
}

export function calculateObjectDomainImportContractSemanticSha256(documentText: string): string {
  const document = parseSemanticDocument(documentText);
  const policy = document.semanticHashPolicy;
  if (policy === null || Array.isArray(policy) || typeof policy !== "object") throw new Error("OBJECT_DOMAIN_IMPORT_SEMANTIC_HASH_POLICY_INVALID");
  const projectionVersion = (policy as Record<string, unknown>).projectionVersion;
  const compatible = (policy as Record<string, unknown>).acceptedCompatibleImportContractSha256;
  const expectedProjectionSha256 = (policy as Record<string, unknown>).currentImportContractProjectionSha256;
  if (projectionVersion !== OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION || typeof expectedProjectionSha256 !== "string" || !HASH.test(expectedProjectionSha256) || !Array.isArray(compatible) || compatible.length !== 1 || compatible[0] !== OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256) throw new Error("OBJECT_DOMAIN_IMPORT_SEMANTIC_HASH_POLICY_INVALID");
  const { semanticHashPolicy: _semanticHashPolicy, ...importRelevantContract } = document;
  const actual = sha256(stableDomainImportJson({ projectionVersion: OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION, contract: importRelevantContract }));
  if (actual !== expectedProjectionSha256 || actual === OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256) throw new Error("OBJECT_DOMAIN_IMPORT_CONTRACT_PROJECTION_DRIFT");
  return actual;
}

// Domain Import는 설계 또는 격리 리허설 DB에서만 실행할 수 있습니다.
export function assertObjectDomainImportDatabaseName(databaseName: string): void {
  if (databaseName !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(databaseName)) throw new Error("OBJECT_DOMAIN_IMPORT_OPERATIONAL_DATABASE_REFUSED");
}

function parseObject(value: string, code: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(code); }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(code);
  return parsed as Record<string, unknown>;
}

function parseReferences(value: string): ReferenceBinding[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_JSON_INVALID"); }
  if (!Array.isArray(parsed)) throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_JSON_INVALID");
  return parsed as ReferenceBinding[];
}

function assertNoExecutablePayload(value: unknown): void {
  if (Array.isArray(value)) { for (const child of value) assertNoExecutablePayload(child); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_EXECUTABLE_KEY.test(key)) throw new Error("OBJECT_DOMAIN_IMPORT_EXECUTABLE_PAYLOAD_FORBIDDEN");
    assertNoExecutablePayload(child);
  }
}

function assertTypedValue(column: DomainImportSchemaColumn, value: unknown, origin: string): void {
  if (!VALUE_ORIGINS.has(origin)) throw new Error("OBJECT_DOMAIN_IMPORT_VALUE_ORIGIN_INVALID");
  if (value === null) {
    if (!column.nullable || origin !== "SOURCE_ABSENT") throw new Error(`OBJECT_DOMAIN_IMPORT_NULL_VALUE_INVALID:${column.table}.${column.column}`);
    return;
  }
  if (origin === "SOURCE_ABSENT") throw new Error("OBJECT_DOMAIN_IMPORT_SOURCE_ABSENT_VALUE_INVALID");
  const type = column.sqlType.toUpperCase();
  if (type === "BOOLEAN") {
    if (typeof value !== "boolean") throw new Error("OBJECT_DOMAIN_IMPORT_BOOLEAN_INVALID");
    return;
  }
  const integer = /^(TINYINT|INT|BIGINT)( UNSIGNED)?$/.exec(type);
  if (integer !== null) {
    const pattern = integer[2] === undefined ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/;
    if (typeof value !== "string" || !pattern.test(value)) throw new Error("OBJECT_DOMAIN_IMPORT_INTEGER_INVALID");
    const bits = integer[1] === "TINYINT" ? 8n : integer[1] === "INT" ? 32n : 64n;
    const parsed = BigInt(value);
    const minimum = integer[2] === undefined ? -(1n << (bits - 1n)) : 0n;
    const maximum = integer[2] === undefined ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
    if (parsed < minimum || parsed > maximum) throw new Error("OBJECT_DOMAIN_IMPORT_INTEGER_RANGE_INVALID");
    return;
  }
  const decimal = /^DECIMAL\((\d+),(\d+)\)$/.exec(type);
  if (decimal !== null) {
    if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("OBJECT_DOMAIN_IMPORT_DECIMAL_INVALID");
    const digits = value.replace(/^-/, "").split(".");
    const integerDigits = digits[0]!.replace(/^0+/, "").length;
    const fractionDigits = digits[1]?.length ?? 0;
    if (integerDigits > Number(decimal[1]) - Number(decimal[2]) || fractionDigits > Number(decimal[2])) throw new Error("OBJECT_DOMAIN_IMPORT_DECIMAL_RANGE_INVALID");
    return;
  }
  if (type === "JSON") { assertNoExecutablePayload(value); return; }
  if (type === "TEXT") { if (typeof value !== "string") throw new Error("OBJECT_DOMAIN_IMPORT_TEXT_INVALID"); return; }
  const length = /^(?:CHAR|VARCHAR)\((\d+)\)$/.exec(type);
  if (length !== null) {
    if (typeof value !== "string" || [...value].length > Number(length[1])) throw new Error("OBJECT_DOMAIN_IMPORT_STRING_INVALID");
    if (type === "CHAR(19)" && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error("OBJECT_DOMAIN_IMPORT_KST_TIME_INVALID");
    if (type === "CHAR(64)" && !HASH.test(value)) throw new Error("OBJECT_DOMAIN_IMPORT_HASH_VALUE_INVALID");
    return;
  }
  throw new Error("OBJECT_DOMAIN_IMPORT_SQL_TYPE_UNKNOWN");
}

function assertPolicy(policy: DomainImportPolicy): void {
  if (policy.catalogVersion !== "SC-20260902-1" || !HASH.test(policy.targetSchemaSha256) || !HASH.test(policy.importContractSha256)) throw new Error("OBJECT_DOMAIN_IMPORT_POLICY_INVALID");
  if (policy.acceptedImportContractSha256.length !== 2 || policy.acceptedImportContractSha256[0] !== policy.importContractSha256 || policy.acceptedImportContractSha256[1] !== OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256 || policy.importContractSha256 === OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256) throw new Error("OBJECT_DOMAIN_IMPORT_COMPATIBLE_CONTRACT_POLICY_INVALID");
  for (const key of ["identityBindings", "objectModel", "disposition", "fieldMap"] as const) if (!HASH.test(policy.componentSemanticSha256[key]) || policy.componentSemanticSha256[key] !== policy.contractComponentSemanticSha256[key]) throw new Error("OBJECT_DOMAIN_IMPORT_COMPONENT_CONTRACT_DRIFT");
  if (new Set(policy.directTargets).size !== 45 || policy.directTargets.length !== 45) throw new Error("OBJECT_DOMAIN_IMPORT_DIRECT_TARGET_SCOPE_MISMATCH");
  if (new Set(policy.definitionTargets).size !== 23 || policy.definitionTargets.length !== 23) throw new Error("OBJECT_DOMAIN_IMPORT_DEFINITION_TARGET_SCOPE_MISMATCH");
  if (policy.columns.length !== 241 || new Set(policy.columns.map((column) => `${column.table}.${column.column}`)).size !== 241) throw new Error("OBJECT_DOMAIN_IMPORT_COLUMN_SCOPE_MISMATCH");
  const identities = [...policy.generatedBindings.map((row) => row.targetTable), ...policy.reusedBindings.map((row) => row.targetTable)];
  if (identities.length !== 45 || new Set(identities).size !== 45 || stableDomainImportJson([...identities].sort()) !== stableDomainImportJson([...policy.directTargets].sort())) throw new Error("OBJECT_DOMAIN_IMPORT_IDENTITY_SCOPE_MISMATCH");
  if (policy.directTargets.some((table) => !policy.columns.some((column) => column.table === table)) || policy.definitionTargets.some((table) => !policy.directTargets.includes(table))) throw new Error("OBJECT_DOMAIN_IMPORT_TARGET_SCHEMA_MISMATCH");
  const identifiers = [...policy.directTargets, ...policy.columns.flatMap((column) => [column.table, column.column]), ...policy.generatedBindings.flatMap((binding) => [binding.targetTable, binding.targetPkColumn]), ...policy.reusedBindings.flatMap((binding) => [binding.targetTable, binding.targetPkColumn, binding.sourceTable, binding.sourceColumn]), ...policy.foreignKeys.flatMap((foreignKey) => [foreignKey.table, foreignKey.column, foreignKey.referencesTable, foreignKey.referencesColumn])];
  if (identifiers.some((identifier) => !SQL_IDENTIFIER.test(identifier))) throw new Error("OBJECT_DOMAIN_IMPORT_SQL_IDENTIFIER_INVALID");
}

function validateDomainRules(row: PreparedRow): void {
  const origins = row.valueOrigins;
  if (Object.values(origins).includes("APPROVED_CATALOG") && (row.approval_kind !== "CATALOG_PROVENANCE" || !HASH.test(row.approval_sha256 ?? ""))) throw new Error("OBJECT_DOMAIN_IMPORT_CATALOG_APPROVAL_REQUIRED");
  if (Object.values(origins).includes("EXPLICIT_RULE") && (row.approval_kind !== "RULE_PROVENANCE" || !HASH.test(row.approval_sha256 ?? ""))) throw new Error("OBJECT_DOMAIN_IMPORT_RULE_APPROVAL_REQUIRED");
  if (row.target_table_name === "object_furniture_definitions") {
    if (origins.purchase_price !== "APPROVED_CATALOG" || origins.charm_per_enhancement !== "APPROVED_CATALOG" || "rate" in row.payload) throw new Error("OBJECT_DOMAIN_IMPORT_FURNITURE_PROJECTION_INVALID");
  }
  if (row.target_table_name === "canonical_owned_mini_pet_instances") {
    if (row.approval_kind !== "OCCURRENCE_CROSSWALK" || !HASH.test(row.approval_sha256 ?? "")) throw new Error("OBJECT_DOMAIN_IMPORT_MINI_PET_OCCURRENCE_APPROVAL_REQUIRED");
    const mini = row.references.find((reference) => reference.column === "mini_pet_id");
    if (mini?.bindingScope !== "APPROVED_CROSSWALK" || !HASH.test(mini.approvalSha256 ?? "")) throw new Error("OBJECT_DOMAIN_IMPORT_MINI_PET_CROSSWALK_REQUIRED");
    const bag = row.source_role === "MINI_PET_BAG" && row.payload.equipped_flag === false && row.payload.bound_flag === false;
    const equipped = row.source_role === "MINI_PET_EQUIPPED" && row.payload.equipped_flag === true && row.payload.bound_flag === true;
    if (!bag && !equipped) throw new Error("OBJECT_DOMAIN_IMPORT_MINI_PET_SOURCE_ROLE_INVALID");
    if (origins.enhancement_level === "CONSTANT_CONTRACT" && row.payload.enhancement_level !== "0") throw new Error("OBJECT_DOMAIN_IMPORT_MINI_PET_DEFAULT_ENHANCEMENT_INVALID");
  }
  if (/^canonical_(?:member|pet|mini_pet)_title_definitions$/.test(row.target_table_name) && origins.base_sale_price !== "APPROVED_CATALOG") throw new Error("OBJECT_DOMAIN_IMPORT_TITLE_DEFINITION_PRICE_INVALID");
  if (/^canonical_owned_(?:member|pet|mini_pet)_title_instances$/.test(row.target_table_name) && !["SOURCE_EXACT", "SOURCE_ABSENT"].includes(origins.acquisition_price ?? "")) throw new Error("OBJECT_DOMAIN_IMPORT_TITLE_ACQUISITION_PRICE_INVALID");
  if (row.target_table_name === "canonical_pet_skill_definitions") {
    if (typeof row.payload.handler_key !== "string" || !TOKEN.test(row.payload.handler_key)) throw new Error("OBJECT_DOMAIN_IMPORT_PET_SKILL_HANDLER_INVALID");
    assertNoExecutablePayload(row.payload.options_json);
  }
  if (row.target_table_name === "canonical_currency_operations" && (row.payload.operation_kind !== "INITIAL_IMPORT" || row.payload.operation_status !== "completed")) throw new Error("OBJECT_DOMAIN_IMPORT_CURRENCY_BASELINE_INVALID");
  const allowed = (column: string, values: readonly string[]): void => {
    if (column in row.payload && !values.includes(String(row.payload[column]))) throw new Error(`OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:${row.target_table_name}.${column}`);
  };
  const positive = (column: string): void => {
    if (column in row.payload && Number(row.payload[column]) <= 0) throw new Error(`OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:${row.target_table_name}.${column}`);
  };
  const nonzero = (column: string): void => {
    if (column in row.payload && Number(row.payload[column]) === 0) throw new Error(`OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:${row.target_table_name}.${column}`);
  };
  if (row.target_table_name === "object_owned_furniture_instances") allowed("ownership_status", ["bag", "placed", "listed", "sold", "removed"]);
  if (row.target_table_name === "object_furniture_operation_history") { allowed("status_before", ["bag", "placed", "listed", "sold", "removed"]); allowed("status_after", ["bag", "placed", "listed", "sold", "removed"]); }
  if (/^object_furniture_(?:market|active_market)_listings$/.test(row.target_table_name)) allowed("listing_status", ["active", "cancelled", "sold"]);
  if (row.target_table_name === "canonical_mini_pet_enhancement_rules") { positive("target_enhancement_level"); if (Number(row.payload.success_probability) < 0 || Number(row.payload.success_probability) > 1) throw new Error("OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:canonical_mini_pet_enhancement_rules.success_probability"); }
  if (row.target_table_name === "canonical_owned_mini_pet_instances") allowed("ownership_status", ["owned", "listed", "consumed", "removed"]);
  if (/^canonical_owned_(?:item|pet|equipment)_instances$/.test(row.target_table_name)) allowed("ownership_status", ["owned", "listed", "consumed", "removed"]);
  if (row.target_table_name === "canonical_mini_pet_replay_operations") { allowed("operation_kind", ["acquire"]); allowed("operation_status", ["completed"]); }
  if (/^canonical_owned_(?:member|pet|mini_pet)_title_instances$/.test(row.target_table_name)) allowed("ownership_status", ["owned", "sold", "removed"]);
  if (row.target_table_name === "canonical_pet_skill_definitions") allowed("handler_key", ["passive_modifier", "command_unlock", "presentation_only"]);
  if (row.target_table_name === "canonical_owned_pet_skill_equipments") { const slot = Number(row.payload.slot_number); if (!Number.isInteger(slot) || slot < 1 || slot > 30) throw new Error("OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:canonical_owned_pet_skill_equipments.slot_number"); }
  if (row.target_table_name === "canonical_pet_skill_replay_operations") { allowed("operation_kind", ["grant", "equip"]); allowed("operation_status", ["completed"]); }
  if (row.target_table_name === "canonical_package_definitions") positive("max_open_quantity");
  if (row.target_table_name === "canonical_package_reward_groups") allowed("selection_mode", ["all", "weighted_one"]);
  if (row.target_table_name === "canonical_package_reward_entries") allowed("target_kind", ["item", "package", "gap"]);
  if (/^canonical_package_(?:item|nested)_rewards$/.test(row.target_table_name)) { positive("quantity"); const probability = Number(row.payload.probability); if (!(probability > 0 && probability <= 1)) throw new Error(`OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:${row.target_table_name}.probability`); }
  if (row.target_table_name === "canonical_package_reward_quarantines") { allowed("target_kind", ["item", "package"]); allowed("quarantine_status", ["open", "resolved", "rejected"]); }
  if (row.target_table_name === "canonical_package_definition_replay_operations") allowed("operation_status", ["completed"]);
  if (row.target_table_name === "canonical_currency_definitions") { const places = Number(row.payload.decimal_places); if (!Number.isInteger(places) || places < 0 || places > 9) throw new Error("OBJECT_DOMAIN_IMPORT_DATABASE_CHECK_INVALID:canonical_currency_definitions.decimal_places"); }
  if (row.target_table_name === "canonical_building_definitions") positive("floor_value");
  if (row.target_table_name === "canonical_craft_recipe_definitions") { allowed("craft_recipe_kind", ["item_exchange", "building_upgrade"]); positive("maximum_batch_count"); }
  if (/^canonical_craft_recipe_(?:item_inputs|item_outputs)$/.test(row.target_table_name)) positive("quantity");
  if (/^canonical_craft_recipe_(?:currency_inputs|currency_outputs)$/.test(row.target_table_name)) positive("amount_minor");
  if (row.target_table_name === "canonical_craft_operations") { positive("requested_count"); allowed("operation_status", ["processing", "completed"]); }
  if (row.target_table_name === "canonical_craft_item_ledger_entries") nonzero("quantity_delta");
  if (row.target_table_name === "canonical_craft_currency_ledger_entries") nonzero("amount_minor_delta");
}

function rowPhase(table: string, policy: DomainImportPolicy): number {
  if (policy.definitionTargets.includes(table)) return 0;
  if (table === "canonical_players") return 1;
  if (OWNERSHIP_TABLE.test(table)) return 2;
  if (table === "canonical_currency_operations" || table === "canonical_currency_ledger_entries") return 3;
  return 2;
}

function prepareRow(row: ProjectionRow, policy: DomainImportPolicy): PreparedRow {
  if (!policy.directTargets.includes(row.target_table_name)) throw new Error("OBJECT_DOMAIN_IMPORT_TARGET_UNKNOWN");
  if (!(policy.domainTargets[row.record_domain.toLowerCase()] ?? []).includes(row.target_table_name)) throw new Error("OBJECT_DOMAIN_IMPORT_DOMAIN_TARGET_MISMATCH");
  if (!HASH.test(row.identity_locator_sha256) || !HASH.test(row.target_payload_fingerprint) || !HASH.test(row.value_origins_fingerprint) || !HASH.test(row.reference_bindings_fingerprint)) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_HASH_INVALID");
  if (sha256(row.target_payload_json) !== row.target_payload_fingerprint || sha256(row.value_origins_json) !== row.value_origins_fingerprint || sha256(row.reference_bindings_json) !== row.reference_bindings_fingerprint) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_FINGERPRINT_DRIFT");
  const payload = parseObject(row.target_payload_json, "OBJECT_DOMAIN_IMPORT_PAYLOAD_JSON_INVALID");
  const valueOrigins = parseObject(row.value_origins_json, "OBJECT_DOMAIN_IMPORT_ORIGIN_JSON_INVALID") as Record<string, string>;
  const references = parseReferences(row.reference_bindings_json);
  assertNoExecutablePayload(payload);
  if (stableDomainImportJson(Object.keys(payload).sort()) !== stableDomainImportJson(Object.keys(valueOrigins).sort())) throw new Error("OBJECT_DOMAIN_IMPORT_ORIGIN_COVERAGE_MISMATCH");
  const generated = policy.generatedBindings.find((binding) => binding.targetTable === row.target_table_name);
  const reused = policy.reusedBindings.find((binding) => binding.targetTable === row.target_table_name);
  const identity = generated ?? reused;
  if (identity === undefined || identity.targetPkColumn !== row.target_pk_column_name) throw new Error("OBJECT_DOMAIN_IMPORT_PK_BINDING_MISMATCH");
  if (generated !== undefined) {
    if (row.identity_mode !== "GENERATED" || generated.objectType !== row.target_object_type || generated.sourceNamespace !== row.target_source_namespace) throw new Error("OBJECT_DOMAIN_IMPORT_GENERATED_BINDING_MISMATCH");
  } else if (row.identity_mode !== "REUSED" || row.target_object_type !== "REUSED_PRIMARY_KEY" || row.target_source_namespace !== `object-import.reused.${row.target_table_name}`) throw new Error("OBJECT_DOMAIN_IMPORT_REUSED_BINDING_MISMATCH");
  const schema = policy.columns.filter((column) => column.table === row.target_table_name);
  const fk = policy.foreignKeys.filter((candidate) => candidate.table === row.target_table_name && candidate.column !== row.target_pk_column_name);
  const expectedPayload = schema.filter((column) => column.column !== row.target_pk_column_name && !fk.some((candidate) => candidate.column === column.column)).map((column) => column.column).sort();
  if (stableDomainImportJson(Object.keys(payload).sort()) !== stableDomainImportJson(expectedPayload)) throw new Error("OBJECT_DOMAIN_IMPORT_PAYLOAD_SCOPE_MISMATCH");
  if (new Set(references.map((reference) => reference.column)).size !== references.length) throw new Error("OBJECT_DOMAIN_IMPORT_DUPLICATE_REFERENCE");
  for (const reference of references) {
    const expected = fk.find((candidate) => candidate.column === reference.column);
    if (expected === undefined || expected.referencesTable !== reference.targetTable || expected.referencesColumn !== reference.targetPkColumn || !HASH.test(reference.identityLocatorSha256)) throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_CONTRACT_MISMATCH");
    if (reference.bindingScope === "APPROVED_CROSSWALK" && !HASH.test(reference.approvalSha256 ?? "")) throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_APPROVAL_REQUIRED");
    if (reference.bindingScope === "MANIFEST" && reference.approvalSha256 !== undefined) throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_SCOPE_INVALID");
  }
  for (const required of fk.filter((candidate) => !schema.find((column) => column.column === candidate.column)?.nullable)) if (!references.some((reference) => reference.column === required.column)) throw new Error("OBJECT_DOMAIN_IMPORT_REQUIRED_REFERENCE_MISSING");
  for (const columnName of Object.keys(payload)) assertTypedValue(schema.find((column) => column.column === columnName)!, payload[columnName], valueOrigins[columnName]!);
  const prepared: PreparedRow = { ...row, payload, valueOrigins, references, bindingFingerprint: sha256(stableDomainImportJson({ targetTable: row.target_table_name, targetPkColumn: row.target_pk_column_name, targetObjectType: row.target_object_type, targetSourceNamespace: row.target_source_namespace, identityLocatorSha256: row.identity_locator_sha256, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsFingerprint: row.reference_bindings_fingerprint, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256 })), phase: rowPhase(row.target_table_name, policy) };
  validateDomainRules(prepared);
  return prepared;
}

function sortRows(rows: PreparedRow[], policy: DomainImportPolicy): PreparedRow[] {
  const byIdentity = new Map(rows.map((row) => [`${row.target_table_name}\0${row.target_pk_column_name}\0${row.identity_locator_sha256}`, row]));
  const remaining = new Set(rows);
  const ordered: PreparedRow[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((row) => {
      const explicitReady = row.references.every((reference) => reference.bindingScope !== "MANIFEST" || !remaining.has(byIdentity.get(`${reference.targetTable}\0${reference.targetPkColumn}\0${reference.identityLocatorSha256}`)!));
      const reused = policy.reusedBindings.find((binding) => binding.targetTable === row.target_table_name && binding.targetPkColumn === row.target_pk_column_name);
      const reusedSource = reused === undefined ? undefined : byIdentity.get(`${reused.sourceTable}\0${reused.sourceColumn}\0${row.identity_locator_sha256}`);
      return explicitReady && (reusedSource === undefined || !remaining.has(reusedSource));
    });
    if (ready.length === 0) throw new Error("OBJECT_DOMAIN_IMPORT_MANIFEST_REFERENCE_CYCLE");
    const minimumPhase = Math.min(...ready.map((row) => row.phase));
    if (minimumPhase > 0 && [...remaining].some((row) => row.phase === 0)) throw new Error("OBJECT_DOMAIN_IMPORT_DEFINITION_DEPENDS_ON_OWNERSHIP");
    const selected = ready.filter((row) => row.phase === minimumPhase).sort((left, right) => `${left.target_table_name}\0${left.projection_locator}`.localeCompare(`${right.target_table_name}\0${right.projection_locator}`, "en"));
    for (const row of selected) { remaining.delete(row); ordered.push(row); }
  }
  return ordered;
}

function validateCrossRecordRules(rows: PreparedRow[], policy: DomainImportPolicy): void {
  const rowByIdentity = new Map(rows.map((row) => [`${row.target_table_name}\0${row.target_pk_column_name}\0${row.identity_locator_sha256}`, row]));
  const manifests = new Set(rowByIdentity.keys());
  for (const row of rows) for (const reference of row.references) if (reference.bindingScope === "MANIFEST" && !manifests.has(`${reference.targetTable}\0${reference.targetPkColumn}\0${reference.identityLocatorSha256}`)) throw new Error("OBJECT_DOMAIN_IMPORT_MANIFEST_REFERENCE_UNRESOLVED");
  for (const row of rows) {
    const reused = policy.reusedBindings.find((binding) => binding.targetTable === row.target_table_name && binding.targetPkColumn === row.target_pk_column_name);
    if (reused !== undefined && !manifests.has(`${reused.sourceTable}\0${reused.sourceColumn}\0${row.identity_locator_sha256}`)) throw new Error("OBJECT_DOMAIN_IMPORT_REUSED_PRIMARY_KEY_SOURCE_UNRESOLVED");
  }
  for (const row of rows) {
    const reusedOwner = policy.reusedBindings.some((binding) => binding.targetTable === row.target_table_name && binding.sourceTable === "canonical_players") ? row.identity_locator_sha256 : undefined;
    const owner = row.references.find((reference) => reference.column === "player_id")?.identityLocatorSha256 ?? reusedOwner;
    if (owner === undefined) continue;
    for (const reference of row.references.filter((candidate) => candidate.bindingScope === "MANIFEST")) {
      const target = rowByIdentity.get(`${reference.targetTable}\0${reference.targetPkColumn}\0${reference.identityLocatorSha256}`);
      const targetOwner = target?.references.find((candidate) => candidate.column === "player_id")?.identityLocatorSha256;
      if (targetOwner !== undefined && targetOwner !== owner) throw new Error("OBJECT_DOMAIN_IMPORT_CROSS_OWNER_REFERENCE");
    }
  }
  for (const equipment of rows.filter((row) => row.target_table_name === "canonical_owned_pet_skill_equipments")) {
    const owner = equipment.references.find((reference) => reference.column === "player_id")?.identityLocatorSha256;
    const skill = equipment.references.find((reference) => reference.column === "pet_skill_id")?.identityLocatorSha256;
    const matchingStacks = rows.filter((row) => row.target_table_name === "canonical_owned_pet_skill_stacks"
      && row.references.some((reference) => reference.column === "player_id" && reference.identityLocatorSha256 === owner)
      && row.references.some((reference) => reference.column === "pet_skill_id" && reference.identityLocatorSha256 === skill)
      && BigInt(String(row.payload.quantity)) > 0n);
    if (owner === undefined || skill === undefined || matchingStacks.length !== 1) throw new Error("OBJECT_DOMAIN_IMPORT_PET_SKILL_STACK_REQUIRED");
  }
  for (const ledger of rows.filter((row) => row.target_table_name === "canonical_item_inventory_ledger_entries")) {
    const targets = ledger.references.filter((reference) => reference.column === "owned_item_stack_id" || reference.column === "owned_item_id");
    if (targets.length !== 1) throw new Error("OBJECT_DOMAIN_IMPORT_ITEM_LEDGER_TARGET_INVALID");
  }
  const rewardEntries = new Map(rows.filter((row) => row.target_table_name === "canonical_package_reward_entries").map((row) => [row.identity_locator_sha256, row]));
  const extensionLocators = new Set<string>();
  for (const extension of rows.filter((row) => row.target_table_name === "canonical_package_item_rewards" || row.target_table_name === "canonical_package_nested_rewards")) {
    const expectedKind = extension.target_table_name === "canonical_package_item_rewards" ? "item" : "package";
    const entry = rewardEntries.get(extension.identity_locator_sha256);
    if (entry?.payload.target_kind !== expectedKind || extensionLocators.has(extension.identity_locator_sha256)) throw new Error("OBJECT_DOMAIN_IMPORT_PACKAGE_TYPED_EXTENSION_INVALID");
    extensionLocators.add(extension.identity_locator_sha256);
  }
  for (const entry of rewardEntries.values()) {
    const requiresExtension = entry.payload.target_kind === "item" || entry.payload.target_kind === "package";
    if (requiresExtension !== extensionLocators.has(entry.identity_locator_sha256)) throw new Error("OBJECT_DOMAIN_IMPORT_PACKAGE_TYPED_EXTENSION_INVALID");
  }
  const packageEdges = new Map<string, string[]>();
  for (const nested of rows.filter((row) => row.target_table_name === "canonical_package_nested_rewards")) {
    const entry = rewardEntries.get(nested.identity_locator_sha256);
    const groupLocator = entry?.references.find((reference) => reference.column === "package_reward_group_id")?.identityLocatorSha256;
    const group = rows.find((row) => row.target_table_name === "canonical_package_reward_groups" && row.identity_locator_sha256 === groupLocator);
    const ownerPackage = group?.references.find((reference) => reference.column === "package_id")?.identityLocatorSha256;
    const targetPackage = nested.references.find((reference) => reference.column === "package_id")?.identityLocatorSha256;
    if (ownerPackage === undefined || targetPackage === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_PACKAGE_GRAPH_INVALID");
    packageEdges.set(ownerPackage, [...(packageEdges.get(ownerPackage) ?? []), targetPackage]);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (packageLocator: string): void => {
    if (active.has(packageLocator)) throw new Error("OBJECT_DOMAIN_IMPORT_PACKAGE_CYCLE");
    if (visited.has(packageLocator)) return;
    active.add(packageLocator);
    for (const target of packageEdges.get(packageLocator) ?? []) visit(target);
    active.delete(packageLocator);
    visited.add(packageLocator);
  };
  for (const packageLocator of packageEdges.keys()) visit(packageLocator);
  const buildings = rows.filter((row) => row.target_table_name === "canonical_building_definitions");
  const floors = new Map<string, PreparedRow[]>();
  for (const row of buildings) { const key = String(row.payload.floor_value); floors.set(key, [...(floors.get(key) ?? []), row]); }
  for (const group of floors.values()) if (group.length > 1) {
    const ordered = [...group].sort((left, right) => left.projection_locator.localeCompare(right.projection_locator, "en"));
    if (ordered[0]!.payload.active_flag !== true || ordered.slice(1).some((row) => row.payload.active_flag !== false)) throw new Error("OBJECT_DOMAIN_IMPORT_BUILDING_DUPLICATE_POLICY_INVALID");
  }
  const balances = rows.filter((row) => row.target_table_name === "canonical_player_currency_balances");
  for (const balance of balances) {
    const balanceLocator = balance.identity_locator_sha256;
    const operations = rows.filter((row) => row.target_table_name === "canonical_currency_operations" && row.references.some((reference) => reference.targetTable === "canonical_player_currency_balances" && reference.identityLocatorSha256 === balanceLocator));
    if (operations.length !== 1 || operations[0]!.payload.balance_after_minor_amount !== balance.payload.balance_minor_amount || operations[0]!.payload.delta_minor_amount !== balance.payload.balance_minor_amount) throw new Error("OBJECT_DOMAIN_IMPORT_CURRENCY_OPERATION_PARITY_INVALID");
    const operation = operations[0]!;
    const ledgers = rows.filter((row) => row.target_table_name === "canonical_currency_ledger_entries" && row.references.some((reference) => reference.targetTable === "canonical_currency_operations" && reference.identityLocatorSha256 === operation.identity_locator_sha256));
    if (ledgers.length !== 1 || ledgers[0]!.payload.sequence_number !== "1" || ledgers[0]!.payload.delta_minor_amount !== balance.payload.balance_minor_amount || ledgers[0]!.payload.balance_after_minor_amount !== balance.payload.balance_minor_amount) throw new Error("OBJECT_DOMAIN_IMPORT_CURRENCY_LEDGER_PARITY_INVALID");
  }
}

function calculateImportPlanSha256(run: ProjectionRunRow, decisions: DecisionRow[], rows: PreparedRow[], targetSchemaSha256: string, importContractSha256: string): string {
  return sha256(stableDomainImportJson({ catalogProjectionRunId: run.catalog_projection_run_id, projectionManifestSha256: run.projection_manifest_sha256, projectionSha256: run.projection_sha256, upstreamEnvelopeSha256: run.upstream_envelope_sha256, targetSchemaSha256, importContractSha256, decisions: decisions.map((row) => ({ id: row.catalog_source_decision_id, fingerprint: row.decision_fingerprint })).sort((a, b) => a.id.localeCompare(b.id, "en")), rows: rows.map((row) => ({ id: row.catalog_projection_record_id, fingerprint: row.bindingFingerprint })) }));
}

// COMPLETE projection의 전수 decision과 45개 direct target 계약을 쓰기 전에 검증합니다.
export function buildObjectDomainImportPlan(run: ProjectionRunRow, decisions: DecisionRow[], projectionRows: ProjectionRow[], policy: DomainImportPolicy): DomainImportPlan {
  assertPolicy(policy);
  if (run.run_status !== "COMPLETE" || run.catalog_version !== policy.catalogVersion || run.target_schema_sha256 !== policy.targetSchemaSha256 || !HASH.test(run.projection_manifest_sha256) || !HASH.test(run.projection_sha256) || !HASH.test(run.upstream_envelope_sha256)) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_RUN_INVALID");
  if (decisions.length !== Number(run.expected_source_count) || new Set(decisions.map((row) => row.catalog_source_decision_id)).size !== decisions.length) throw new Error("OBJECT_DOMAIN_IMPORT_DECISION_COVERAGE_MISMATCH");
  const counts = { PROJECT: 0, QUARANTINE: 0, IGNORE: 0 };
  const outputCounts = new Map<string, number>();
  for (const row of projectionRows) outputCounts.set(row.catalog_source_decision_id, (outputCounts.get(row.catalog_source_decision_id) ?? 0) + 1);
  for (const decision of decisions) {
    if (!(decision.decision_status in counts) || !HASH.test(decision.source_locator_sha256) || !HASH.test(decision.source_payload_fingerprint) || !HASH.test(decision.decision_fingerprint)) throw new Error("OBJECT_DOMAIN_IMPORT_DECISION_INVALID");
    counts[decision.decision_status as keyof typeof counts] += 1;
    const actualRows = outputCounts.get(decision.catalog_source_decision_id) ?? 0;
    if (actualRows !== Number(decision.projected_row_count) || (decision.decision_status === "PROJECT") !== (actualRows > 0)) throw new Error("OBJECT_DOMAIN_IMPORT_DECISION_ROW_COUNT_MISMATCH");
    if (decision.source_locator_sha256 !== decision.staging_source_locator_sha256 || decision.source_payload_fingerprint !== decision.staging_payload_fingerprint || decision.record_domain !== decision.staging_record_domain) throw new Error("OBJECT_DOMAIN_IMPORT_STAGING_DECISION_DRIFT");
    if (decision.staging_projection_status === "QUARANTINE" && (decision.decision_status !== "QUARANTINE" || decision.decision_reason !== decision.staging_quarantine_reason)) throw new Error("OBJECT_DOMAIN_IMPORT_STAGING_QUARANTINE_MUST_PROPAGATE");
    if (decision.decision_status === "QUARANTINE" && (!decision.decision_reason || !policy.quarantineReasons.includes(decision.decision_reason))) throw new Error("OBJECT_DOMAIN_IMPORT_QUARANTINE_REASON_INVALID");
    if (decision.decision_status === "IGNORE" && decision.decision_reason !== "NOT_OBJECT_DOMAIN_INPUT") throw new Error("OBJECT_DOMAIN_IMPORT_IGNORE_REASON_INVALID");
  }
  if (counts.PROJECT !== Number(run.projected_source_count) || counts.QUARANTINE !== Number(run.quarantined_source_count) || counts.IGNORE !== Number(run.ignored_source_count) || projectionRows.length !== Number(run.projected_row_count)) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_COUNT_MISMATCH");
  const decisionIds = new Set(decisions.map((row) => row.catalog_source_decision_id));
  if (projectionRows.some((row) => !decisionIds.has(row.catalog_source_decision_id) || row.decision_status !== "PROJECT")) throw new Error("OBJECT_DOMAIN_IMPORT_ORPHAN_PROJECTION_ROW");
  const prepared = projectionRows.map((row) => prepareRow(row, policy));
  const decisionsById = new Map(decisions.map((decision) => [decision.catalog_source_decision_id, decision]));
  for (const row of prepared) if (row.target_table_name === "canonical_owned_mini_pet_instances" && row.source_role !== decisionsById.get(row.catalog_source_decision_id)?.record_kind) throw new Error("OBJECT_DOMAIN_IMPORT_MINI_PET_STAGING_ROLE_MISMATCH");
  const projectedDecisions = [...decisions].sort((left, right) => left.source_locator_sha256.localeCompare(right.source_locator_sha256, "en")).map((decision) => {
    const outputs = prepared.filter((row) => row.catalog_source_decision_id === decision.catalog_source_decision_id).sort((left, right) => `${left.target_table_name}\0${left.projection_locator}`.localeCompare(`${right.target_table_name}\0${right.projection_locator}`, "en")).map((row) => ({
      projectionLocator: row.projection_locator,
      identityLocatorSha256: row.identity_locator_sha256,
      identityMode: row.identity_mode,
      targetTable: row.target_table_name,
      targetPkColumn: row.target_pk_column_name,
      targetObjectType: row.target_object_type,
      targetSourceNamespace: row.target_source_namespace,
      sourceRole: row.source_role,
      approvalKind: row.approval_kind,
      approvalSha256: row.approval_sha256,
      targetPayloadJson: row.target_payload_json,
      targetPayloadFingerprint: row.target_payload_fingerprint,
      valueOriginsJson: row.value_origins_json,
      valueOriginsFingerprint: row.value_origins_fingerprint,
      referenceBindingsJson: row.reference_bindings_json,
      referenceBindingsFingerprint: row.reference_bindings_fingerprint
    }));
    const body = { sourceLocatorSha256: decision.source_locator_sha256, sourcePayloadFingerprint: decision.source_payload_fingerprint, recordDomain: decision.record_domain, decisionStatus: decision.decision_status, decisionReason: decision.decision_reason, outputs };
    if (sha256(stableDomainImportJson(body)) !== decision.decision_fingerprint) throw new Error("OBJECT_DOMAIN_IMPORT_DECISION_FINGERPRINT_DRIFT");
    return { ...body, decisionFingerprint: decision.decision_fingerprint };
  });
  if (sha256(stableDomainImportJson(projectedDecisions)) !== run.projection_sha256) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_FINGERPRINT_DRIFT");
  const identities = prepared.map((row) => `${row.target_source_namespace}\0${row.identity_locator_sha256}`);
  if (new Set(identities).size !== identities.length) throw new Error("OBJECT_DOMAIN_IMPORT_DUPLICATE_IDENTITY_LOCATOR");
  validateCrossRecordRules(prepared, policy);
  const rows = sortRows(prepared, policy);
  let ownershipSeen = false;
  for (const row of rows) { if (row.phase >= 2) ownershipSeen = true; if (ownershipSeen && row.phase === 0) throw new Error("OBJECT_DOMAIN_IMPORT_DEFINITION_ORDER_INVALID"); }
  const importSha256 = calculateImportPlanSha256(run, decisions, rows, policy.targetSchemaSha256, policy.importContractSha256);
  return { importSha256, decisions, rows };
}

// migration 458의 manifest hash와 분리된 migration 459 upstream envelope를 Common Staging 원장과 대사합니다.
export function assertObjectDomainImportUpstreamEnvelope(run: ProjectionRunRow, staging: CommonStagingRunRow): void {
  if (staging.run_status !== "COMPLETE" || staging.common_staging_run_id !== run.common_staging_run_id) throw new Error("OBJECT_DOMAIN_IMPORT_STAGING_RUN_NOT_COMPLETE");
  const equal = run.raw_bundle_sha256 === staging.raw_bundle_sha256 && run.snapshot_manifest_sha256 === staging.snapshot_manifest_sha256 && run.extraction_manifest_sha256 === staging.extraction_manifest_sha256 && Number(run.expected_file_count) === Number(staging.expected_file_count) && String(run.expected_total_bytes) === String(staging.expected_total_bytes) && Number(run.projected_file_count) === Number(staging.projected_file_count) && Number(run.ignored_file_count) === Number(staging.ignored_file_count);
  if (!equal || Number(staging.projected_file_count) + Number(staging.ignored_file_count) !== Number(staging.expected_file_count)) throw new Error("OBJECT_DOMAIN_IMPORT_STAGING_ENVELOPE_MISMATCH");
  const expected = sha256(stableDomainImportJson({ expectedFileCount: Number(staging.expected_file_count), expectedTotalBytes: String(staging.expected_total_bytes), extractionManifestSha256: staging.extraction_manifest_sha256, ignoredFileCount: Number(staging.ignored_file_count), projectedFileCount: Number(staging.projected_file_count), rawBundleSha256: staging.raw_bundle_sha256, snapshotManifestSha256: staging.snapshot_manifest_sha256, stagingSha256: staging.staging_sha256 }));
  if (expected !== run.upstream_envelope_sha256) throw new Error("OBJECT_DOMAIN_IMPORT_UPSTREAM_ENVELOPE_FINGERPRINT_DRIFT");
}

function generatedNamespace(policy: DomainImportPolicy, table: string, pk: string): string {
  const binding = policy.generatedBindings.find((candidate) => candidate.targetTable === table && candidate.targetPkColumn === pk);
  if (binding === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_TARGET_NOT_GENERATED");
  return binding.sourceNamespace;
}

function sqlValue(value: unknown, sqlType: string): unknown {
  if (value === null) return null;
  if (sqlType === "BOOLEAN") return value ? 1 : 0;
  if (sqlType === "JSON") return stableDomainImportJson(value);
  return value;
}

function canonicalRowFingerprint(row: PreparedRow, targetPk: string, references: Record<string, string>): string {
  return sha256(stableDomainImportJson({ table: row.target_table_name, pkColumn: row.target_pk_column_name, pk: targetPk, payload: row.payload, references }));
}

function normalizeDecimal(value: unknown): string {
  const raw = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (match === null) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_TARGET_DECIMAL_INVALID");
  const integer = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const magnitude = fraction === "" ? integer : `${integer}.${fraction}`;
  return magnitude === "0" ? "0" : `${match[1]}${magnitude}`;
}

function normalizeComparableValue(value: unknown, sqlType: string, stored: boolean): unknown {
  if (value === null) return null;
  if (sqlType === "BOOLEAN") return value === true || value === 1 || value === 1n || value === "1";
  if (sqlType === "JSON") {
    if (!stored || typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_TARGET_JSON_INVALID"); }
  }
  if (/^(?:TINYINT|INT|BIGINT)(?: UNSIGNED)?$/.test(sqlType)) {
    try { return BigInt(String(value)).toString(); } catch { throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_TARGET_INTEGER_INVALID"); }
  }
  if (/^DECIMAL/.test(sqlType)) return normalizeDecimal(value);
  return value;
}

// Catalog Projection 결과를 하나의 outer transaction에서 identity, target, receipt 순으로 원자 적재합니다.
export class MariaObjectDomainImporter {
  constructor(private readonly database: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  private async findCompatiblePriorRun(transaction: DatabaseTransaction, catalogProjectionRunId: string, policy: DomainImportPolicy): Promise<PriorRunRow | undefined> {
    const runs = await transaction.query<PriorRunRow[]>("SELECT object_domain_import_run_id,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status FROM data_migration_object_domain_import_runs WHERE catalog_projection_run_id=? AND catalog_version=? FOR UPDATE", [catalogProjectionRunId, policy.catalogVersion]);
    if (runs.length > 1) throw new Error("OBJECT_DOMAIN_IMPORT_COMPATIBLE_RUN_AMBIGUOUS");
    const run = runs[0];
    if (run !== undefined && !policy.acceptedImportContractSha256.includes(run.import_contract_sha256)) throw new Error("OBJECT_DOMAIN_IMPORT_CONTRACT_IDENTITY_INCOMPATIBLE");
    return run;
  }

  async importProjection(catalogProjectionRunId: string, policy: DomainImportPolicy, actor: string): Promise<DomainImportResult> {
    if (!/^[a-z0-9]{8}$/.test(catalogProjectionRunId)) throw new Error("OBJECT_DOMAIN_IMPORT_RUN_ID_INVALID");
    const audit = createObjectAuditValues(actor, this.now());
    return this.database.withTransaction(async (transaction) => {
      const run = (await transaction.query<ProjectionRunRow[]>("SELECT catalog_projection_run_id,common_staging_run_id,catalog_version,projection_manifest_sha256,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,target_schema_sha256,projection_sha256,upstream_envelope_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status FROM data_migration_catalog_projection_runs WHERE catalog_projection_run_id=? FOR UPDATE", [catalogProjectionRunId]))[0];
      if (run === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_RUN_NOT_FOUND");
      const staging = (await transaction.query<CommonStagingRunRow[]>("SELECT common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE common_staging_run_id=? FOR UPDATE", [run.common_staging_run_id]))[0];
      if (staging === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_STAGING_RUN_NOT_FOUND");
      assertObjectDomainImportUpstreamEnvelope(run, staging);
      const decisions = await transaction.query<DecisionRow[]>("SELECT decision.catalog_source_decision_id,decision.source_locator_sha256,decision.source_payload_fingerprint,decision.record_domain,decision.decision_status,decision.decision_reason,decision.projected_row_count,decision.decision_fingerprint,staging.record_domain staging_record_domain,staging.record_kind,staging.projection_status staging_projection_status,staging.quarantine_reason staging_quarantine_reason,staging.source_locator_sha256 staging_source_locator_sha256,staging.payload_fingerprint staging_payload_fingerprint FROM data_migration_catalog_source_decisions decision JOIN data_migration_common_staging_records staging ON staging.common_staging_record_id=decision.common_staging_record_id WHERE decision.catalog_projection_run_id=? ORDER BY decision.source_locator_sha256 FOR UPDATE", [catalogProjectionRunId]);
      const rows = await transaction.query<ProjectionRow[]>("SELECT record.catalog_projection_record_id,record.catalog_source_decision_id,record.projection_locator,record.identity_locator_sha256,record.identity_mode,record.target_table_name,record.target_pk_column_name,record.target_object_type,record.target_source_namespace,record.source_role,record.approval_kind,record.approval_sha256,CAST(record.target_payload_json AS CHAR) target_payload_json,record.target_payload_fingerprint,CAST(record.value_origins_json AS CHAR) value_origins_json,record.value_origins_fingerprint,CAST(record.reference_bindings_json AS CHAR) reference_bindings_json,record.reference_bindings_fingerprint,decision.record_domain,decision.decision_status FROM data_migration_catalog_projection_records record JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=record.catalog_source_decision_id WHERE record.catalog_projection_run_id=? ORDER BY record.catalog_projection_record_id FOR UPDATE", [catalogProjectionRunId]);
      const plan = buildObjectDomainImportPlan(run, decisions, rows, policy);
      const prior = await this.findCompatiblePriorRun(transaction, catalogProjectionRunId, policy);
      if (prior !== undefined) {
        await this.verifyReplay(transaction, prior, run, plan, policy);
        return { objectDomainImportRunId: prior.object_domain_import_run_id, insertedCanonicalRows: 0, insertedDecisionReceipts: 0, replayed: true };
      }
      const identityProvider = new MariaObjectIdentityAuditProvider(this.database, undefined, undefined, this.now);
      const ids = new Map<string, string>();
      for (const row of plan.rows.filter((candidate) => candidate.identity_mode === "GENERATED")) {
        const binding = await identityProvider.registerImportBinding(transaction, { actor, objectType: row.target_object_type, sourceSystem: "LEGACY_JSON", sourceNamespace: row.target_source_namespace, sourceLocatorSha256: row.identity_locator_sha256, payloadFingerprint: row.bindingFingerprint });
        ids.set(`${row.target_table_name}\0${row.target_pk_column_name}\0${row.identity_locator_sha256}`, binding.objectIdentityId);
      }
      for (const row of plan.rows.filter((candidate) => candidate.identity_mode === "REUSED")) {
        const binding = policy.reusedBindings.find((candidate) => candidate.targetTable === row.target_table_name)!;
        const manifestValue = ids.get(`${binding.sourceTable}\0${binding.sourceColumn}\0${row.identity_locator_sha256}`);
        const value = manifestValue ?? await this.resolveCrosswalk(transaction, policy, binding.sourceTable, binding.sourceColumn, row.identity_locator_sha256);
        ids.set(`${row.target_table_name}\0${row.target_pk_column_name}\0${row.identity_locator_sha256}`, value);
      }
      const runId = await this.insertWithCuidRetry(transaction, "INSERT INTO data_migration_object_domain_import_runs(object_domain_import_run_id,catalog_projection_run_id,catalog_version,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,'IMPORTING',?,?,?,?)", (candidate) => [candidate, catalogProjectionRunId, policy.catalogVersion, run.projection_sha256, run.upstream_envelope_sha256, policy.targetSchemaSha256, policy.importContractSha256, plan.importSha256, run.expected_source_count, run.projected_source_count, run.quarantined_source_count, run.ignored_source_count, plan.rows.length, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      for (const decision of plan.decisions) await this.insertDecisionReceipt(transaction, runId, decision, audit);
      for (let importOrder = 0; importOrder < plan.rows.length; importOrder += 1) {
        const row = plan.rows[importOrder]!;
        const targetPk = ids.get(`${row.target_table_name}\0${row.target_pk_column_name}\0${row.identity_locator_sha256}`);
        if (targetPk === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_TARGET_ID_UNRESOLVED");
        const references: Record<string, string> = {};
        for (const reference of row.references) references[reference.column] = reference.bindingScope === "MANIFEST"
          ? ids.get(`${reference.targetTable}\0${reference.targetPkColumn}\0${reference.identityLocatorSha256}`) ?? ""
          : await this.resolveCrosswalk(transaction, policy, reference.targetTable, reference.targetPkColumn, reference.identityLocatorSha256);
        if (Object.values(references).some((value) => value === "")) throw new Error("OBJECT_DOMAIN_IMPORT_MANIFEST_REFERENCE_UNRESOLVED");
        await this.insertTarget(transaction, row, targetPk, references, audit, policy);
        await this.insertReceipt(transaction, runId, row, targetPk, references, importOrder, audit);
      }
      await transaction.execute("UPDATE data_migration_object_domain_import_runs SET imported_row_count=?,run_status='COMPLETE',UPDATE_USER=?,UPDATE_TIME=? WHERE object_domain_import_run_id=?", [plan.rows.length, audit.UPDATE_USER, audit.UPDATE_TIME, runId]);
      return { objectDomainImportRunId: runId, insertedCanonicalRows: plan.rows.length, insertedDecisionReceipts: plan.decisions.length, replayed: false };
    });
  }

  async rollback(catalogProjectionRunId: string, policy: DomainImportPolicy): Promise<number> {
    assertPolicy(policy);
    return this.database.withTransaction(async (transaction) => {
      const projectionRun = (await transaction.query<ProjectionRunRow[]>("SELECT catalog_projection_run_id,common_staging_run_id,catalog_version,projection_manifest_sha256,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,target_schema_sha256,projection_sha256,upstream_envelope_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status FROM data_migration_catalog_projection_runs WHERE catalog_projection_run_id=? FOR UPDATE", [catalogProjectionRunId]))[0];
      if (projectionRun === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_PROJECTION_RUN_NOT_FOUND");
      const staging = (await transaction.query<CommonStagingRunRow[]>("SELECT common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE common_staging_run_id=? FOR UPDATE", [projectionRun.common_staging_run_id]))[0];
      if (staging === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_STAGING_RUN_NOT_FOUND");
      assertObjectDomainImportUpstreamEnvelope(projectionRun, staging);
      const decisions = await transaction.query<DecisionRow[]>("SELECT decision.catalog_source_decision_id,decision.source_locator_sha256,decision.source_payload_fingerprint,decision.record_domain,decision.decision_status,decision.decision_reason,decision.projected_row_count,decision.decision_fingerprint,staging.record_domain staging_record_domain,staging.record_kind,staging.projection_status staging_projection_status,staging.quarantine_reason staging_quarantine_reason,staging.source_locator_sha256 staging_source_locator_sha256,staging.payload_fingerprint staging_payload_fingerprint FROM data_migration_catalog_source_decisions decision JOIN data_migration_common_staging_records staging ON staging.common_staging_record_id=decision.common_staging_record_id WHERE decision.catalog_projection_run_id=? ORDER BY decision.source_locator_sha256 FOR UPDATE", [catalogProjectionRunId]);
      const projectionRows = await transaction.query<ProjectionRow[]>("SELECT record.catalog_projection_record_id,record.catalog_source_decision_id,record.projection_locator,record.identity_locator_sha256,record.identity_mode,record.target_table_name,record.target_pk_column_name,record.target_object_type,record.target_source_namespace,record.source_role,record.approval_kind,record.approval_sha256,CAST(record.target_payload_json AS CHAR) target_payload_json,record.target_payload_fingerprint,CAST(record.value_origins_json AS CHAR) value_origins_json,record.value_origins_fingerprint,CAST(record.reference_bindings_json AS CHAR) reference_bindings_json,record.reference_bindings_fingerprint,decision.record_domain,decision.decision_status FROM data_migration_catalog_projection_records record JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=record.catalog_source_decision_id WHERE record.catalog_projection_run_id=? ORDER BY record.catalog_projection_record_id FOR UPDATE", [catalogProjectionRunId]);
      const plan = buildObjectDomainImportPlan(projectionRun, decisions, projectionRows, policy);
      const run = await this.findCompatiblePriorRun(transaction, catalogProjectionRunId, policy);
      if (run === undefined) return 0;
      const receipts = await this.verifyReplay(transaction, run, projectionRun, plan, policy);
      for (const receipt of [...receipts].reverse()) {
        const result = await transaction.execute(`DELETE FROM ${receipt.target_table_name} WHERE ${receipt.target_pk_column_name}=?`, [receipt.target_pk_value]);
        if (result.affectedRows !== 1n) throw new Error("OBJECT_DOMAIN_IMPORT_ROLLBACK_TARGET_MISSING");
      }
      const result = await transaction.execute("DELETE FROM data_migration_object_domain_import_runs WHERE object_domain_import_run_id=?", [run.object_domain_import_run_id]);
      return Number(result.affectedRows);
    });
  }

  private async resolveCrosswalk(transaction: DatabaseTransaction, policy: DomainImportPolicy, table: string, pk: string, locator: string): Promise<string> {
    const namespace = generatedNamespace(policy, table, pk);
    const row = (await transaction.query<Array<{ object_identity_id: string; object_type: string; payload_fingerprint: string | null }>>("SELECT crosswalk.object_identity_id,identity.object_type,crosswalk.payload_fingerprint FROM object_identity_crosswalks crosswalk JOIN object_identities identity ON identity.object_identity_id=crosswalk.object_identity_id WHERE crosswalk.source_system='LEGACY_JSON' AND crosswalk.source_namespace=? AND crosswalk.source_identifier=? FOR UPDATE", [namespace, locator]))[0];
    const expected = policy.generatedBindings.find((candidate) => candidate.targetTable === table && candidate.targetPkColumn === pk)!;
    if (row === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_APPROVED_CROSSWALK_NOT_FOUND");
    if (row.object_type !== expected.objectType || row.payload_fingerprint === null) throw new Error("OBJECT_DOMAIN_IMPORT_APPROVED_CROSSWALK_INVALID");
    const target = await transaction.query<Array<Record<string, unknown>>>(`SELECT ${pk} FROM ${table} WHERE ${pk}=? FOR UPDATE`, [row.object_identity_id]);
    if (target.length !== 1 || String(target[0]![pk]) !== row.object_identity_id) throw new Error("OBJECT_DOMAIN_IMPORT_REFERENCE_TARGET_MISSING");
    return row.object_identity_id;
  }

  private async resolveGeneratedImportBinding(transaction: DatabaseTransaction, policy: DomainImportPolicy, row: PreparedRow): Promise<string> {
    const expected = policy.generatedBindings.find((binding) => binding.targetTable === row.target_table_name && binding.targetPkColumn === row.target_pk_column_name);
    if (expected === undefined) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_IDENTITY_BINDING_MISMATCH");
    const binding = (await transaction.query<Array<{ object_identity_id: string; object_type: string; payload_fingerprint: string | null }>>("SELECT crosswalk.object_identity_id,identity.object_type,crosswalk.payload_fingerprint FROM object_identity_crosswalks crosswalk JOIN object_identities identity ON identity.object_identity_id=crosswalk.object_identity_id WHERE crosswalk.source_system='LEGACY_JSON' AND crosswalk.source_namespace=? AND crosswalk.source_identifier=? FOR UPDATE", [expected.sourceNamespace, row.identity_locator_sha256]))[0];
    if (binding === undefined || binding.object_type !== expected.objectType || binding.payload_fingerprint !== row.bindingFingerprint) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_IDENTITY_BINDING_MISMATCH");
    assertObjectIdentityCandidate(binding.object_identity_id);
    return binding.object_identity_id;
  }

  private async insertTarget(transaction: DatabaseTransaction, row: PreparedRow, targetPk: string, references: Record<string, string>, audit: ObjectAuditValues, policy: DomainImportPolicy): Promise<void> {
    const schema = policy.columns.filter((column) => column.table === row.target_table_name);
    const valuesByColumn: Record<string, unknown> = { [row.target_pk_column_name]: targetPk, ...references, ...row.payload, ...audit };
    const columns = [...schema.map((column) => column.column), ...AUDIT_COLUMNS];
    const valueTypes = new Map(schema.map((column) => [column.column, column.sqlType]));
    const values = columns.map((column) => AUDIT_COLUMNS.has(column) ? valuesByColumn[column] : sqlValue(valuesByColumn[column] ?? null, valueTypes.get(column)!));
    const result = await transaction.execute(`INSERT INTO ${row.target_table_name}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, values);
    if (result.affectedRows !== 1n) throw new Error("OBJECT_DOMAIN_IMPORT_TARGET_INSERT_COUNT_INVALID");
  }

  private async insertDecisionReceipt(transaction: DatabaseTransaction, runId: string, decision: DecisionRow, audit: ObjectAuditValues): Promise<void> {
    await this.insertWithCuidRetry(transaction, "INSERT INTO data_migration_object_domain_import_decisions(object_domain_import_decision_id,object_domain_import_run_id,catalog_source_decision_id,source_locator_sha256,decision_status,decision_reason,projected_row_count,decision_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (candidate) => [candidate, runId, decision.catalog_source_decision_id, decision.source_locator_sha256, decision.decision_status, decision.decision_reason, decision.projected_row_count, decision.decision_fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  private async insertReceipt(transaction: DatabaseTransaction, runId: string, row: PreparedRow, targetPk: string, references: Record<string, string>, importOrder: number, audit: ObjectAuditValues): Promise<void> {
    const fingerprint = canonicalRowFingerprint(row, targetPk, references);
    await this.insertWithCuidRetry(transaction, "INSERT INTO data_migration_object_domain_import_records(object_domain_import_record_id,object_domain_import_run_id,catalog_projection_record_id,target_table_name,target_pk_column_name,target_pk_value,identity_locator_sha256,import_order,binding_fingerprint,imported_row_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (candidate) => [candidate, runId, row.catalog_projection_record_id, row.target_table_name, row.target_pk_column_name, targetPk, row.identity_locator_sha256, importOrder, row.bindingFingerprint, fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  private async verifyReplay(transaction: DatabaseTransaction, prior: PriorRunRow, run: ProjectionRunRow, plan: DomainImportPlan, policy: DomainImportPolicy): Promise<ReceiptRow[]> {
    const compatibleImportSha256 = calculateImportPlanSha256(run, plan.decisions, plan.rows, policy.targetSchemaSha256, prior.import_contract_sha256);
    if (prior.run_status !== "COMPLETE" || prior.catalog_projection_sha256 !== run.projection_sha256 || prior.upstream_envelope_sha256 !== run.upstream_envelope_sha256 || prior.target_schema_sha256 !== policy.targetSchemaSha256 || !policy.acceptedImportContractSha256.includes(prior.import_contract_sha256) || prior.import_sha256 !== compatibleImportSha256 || Number(prior.expected_source_count) !== plan.decisions.length || Number(prior.projected_source_count) !== Number(run.projected_source_count) || Number(prior.quarantined_source_count) !== Number(run.quarantined_source_count) || Number(prior.ignored_source_count) !== Number(run.ignored_source_count) || Number(prior.expected_row_count) !== plan.rows.length || Number(prior.imported_row_count) !== plan.rows.length) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_CONFLICT");
    const decisionReceipts = await transaction.query<DecisionReceiptRow[]>("SELECT catalog_source_decision_id,source_locator_sha256,decision_status,decision_reason,projected_row_count,decision_fingerprint FROM data_migration_object_domain_import_decisions WHERE object_domain_import_run_id=? ORDER BY source_locator_sha256", [prior.object_domain_import_run_id]);
    if (decisionReceipts.length !== plan.decisions.length) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_DECISION_RECEIPT_MISMATCH");
    if (new Set(decisionReceipts.map((receipt) => receipt.catalog_source_decision_id)).size !== decisionReceipts.length || new Set(decisionReceipts.map((receipt) => receipt.source_locator_sha256)).size !== decisionReceipts.length) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_DECISION_RECEIPT_MISMATCH");
    const expectedDecisions = new Map(plan.decisions.map((decision) => [decision.catalog_source_decision_id, decision]));
    for (const receipt of decisionReceipts) {
      const decision = expectedDecisions.get(receipt.catalog_source_decision_id);
      if (decision === undefined || receipt.source_locator_sha256 !== decision.source_locator_sha256 || receipt.decision_status !== decision.decision_status || receipt.decision_reason !== decision.decision_reason || Number(receipt.projected_row_count) !== Number(decision.projected_row_count) || receipt.decision_fingerprint !== decision.decision_fingerprint) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_DECISION_RECEIPT_MISMATCH");
    }
    const receipts = await transaction.query<ReceiptRow[]>("SELECT catalog_projection_record_id,target_table_name,target_pk_column_name,target_pk_value,identity_locator_sha256,import_order,binding_fingerprint,imported_row_fingerprint FROM data_migration_object_domain_import_records WHERE object_domain_import_run_id=? ORDER BY import_order", [prior.object_domain_import_run_id]);
    if (receipts.length !== plan.rows.length) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_RECEIPT_MISMATCH");
    if (new Set(receipts.map((receipt) => receipt.catalog_projection_record_id)).size !== receipts.length || new Set(receipts.map((receipt) => receipt.import_order)).size !== receipts.length || receipts.some((receipt, index) => Number(receipt.import_order) !== index)) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_RECEIPT_MISMATCH");
    const byId = new Map(plan.rows.map((row) => [row.catalog_projection_record_id, row]));
    const receiptByIdentity = new Map(receipts.map((receipt) => [`${receipt.target_table_name}\0${receipt.target_pk_column_name}\0${receipt.identity_locator_sha256}`, receipt]));
    for (const [expectedOrder, receipt] of receipts.entries()) {
      const row = byId.get(receipt.catalog_projection_record_id);
      if (row === undefined || plan.rows[expectedOrder]?.catalog_projection_record_id !== receipt.catalog_projection_record_id || receipt.target_table_name !== row.target_table_name || receipt.target_pk_column_name !== row.target_pk_column_name || receipt.identity_locator_sha256 !== row.identity_locator_sha256 || receipt.binding_fingerprint !== row.bindingFingerprint || !HASH.test(receipt.imported_row_fingerprint)) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_RECEIPT_MISMATCH");
      const reused = policy.reusedBindings.find((binding) => binding.targetTable === row.target_table_name && binding.targetPkColumn === row.target_pk_column_name);
      const sourceReceipt = reused === undefined ? undefined : receiptByIdentity.get(`${reused.sourceTable}\0${reused.sourceColumn}\0${row.identity_locator_sha256}`);
      const expectedTargetPk = row.identity_mode === "GENERATED"
        ? await this.resolveGeneratedImportBinding(transaction, policy, row)
        : sourceReceipt?.target_pk_value ?? await this.resolveCrosswalk(transaction, policy, reused!.sourceTable, reused!.sourceColumn, row.identity_locator_sha256);
      if (receipt.target_pk_value !== expectedTargetPk) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_IDENTITY_BINDING_MISMATCH");
      const references: Record<string, string> = {};
      for (const reference of row.references) {
        const imported = receiptByIdentity.get(`${reference.targetTable}\0${reference.targetPkColumn}\0${reference.identityLocatorSha256}`);
        references[reference.column] = imported?.target_pk_value ?? await this.resolveCrosswalk(transaction, policy, reference.targetTable, reference.targetPkColumn, reference.identityLocatorSha256);
      }
      if (canonicalRowFingerprint(row, receipt.target_pk_value, references) !== receipt.imported_row_fingerprint) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_RECEIPT_MISMATCH");
      const schema = policy.columns.filter((column) => column.table === row.target_table_name);
      const stored = await transaction.query<Array<Record<string, unknown>>>(`SELECT ${schema.map((column) => column.column).join(",")} FROM ${row.target_table_name} WHERE ${row.target_pk_column_name}=? FOR UPDATE`, [receipt.target_pk_value]);
      if (stored.length !== 1 || String(stored[0]![row.target_pk_column_name]) !== receipt.target_pk_value) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_TARGET_MISSING");
      const expectedSource = { [row.target_pk_column_name]: receipt.target_pk_value, ...references, ...row.payload };
      const expected = Object.fromEntries(schema.map((column) => [column.column, normalizeComparableValue(expectedSource[column.column], column.sqlType, false)]));
      const actual = Object.fromEntries(schema.map((column) => [column.column, normalizeComparableValue(stored[0]![column.column], column.sqlType, true)]));
      if (stableDomainImportJson(actual) !== stableDomainImportJson(expected)) throw new Error("OBJECT_DOMAIN_IMPORT_REPLAY_TARGET_DRIFT");
    }
    return receipts;
  }

  private async insertWithCuidRetry(transaction: DatabaseTransaction, sql: string, values: (candidate: string) => readonly unknown[]): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = createObjectIdentityCandidate();
      try { await transaction.execute(sql, values(candidate)); return candidate; } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
        const primaryKeyConflict = /(?:for key|key) ['"`](?:[a-z0-9_]+\.)?PRIMARY['"`](?:\s|$)/i.test(message);
        if (code !== "ER_DUP_ENTRY" || !primaryKeyConflict) throw error;
      }
    }
    throw new Error("OBJECT_DOMAIN_IMPORT_CUID_COLLISION_RETRY_EXHAUSTED");
  }
}
