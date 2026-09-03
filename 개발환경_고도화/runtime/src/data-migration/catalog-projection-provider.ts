import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectAuditValues } from "../identity/object-identity-audit-provider.js";

export type CatalogDecisionStatus = "PROJECT" | "QUARANTINE" | "IGNORE";
export type CatalogIdentityMode = "GENERATED" | "REUSED";
export type CatalogValueOrigin = "SOURCE_EXACT" | "SOURCE_ABSENT" | "APPROVED_CATALOG" | "EXPLICIT_RULE" | "DERIVED_INDEX" | "CONSTANT_CONTRACT";

export interface CatalogProjectionReferenceBinding {
  column: string;
  targetTable: string;
  targetPkColumn: string;
  identityLocatorSha256: string;
  bindingScope: "MANIFEST" | "APPROVED_CROSSWALK";
  approvalSha256?: string;
}

export interface CatalogProjectionOutputDirective {
  projectionLocator: string;
  identityMode: CatalogIdentityMode;
  targetTable: string;
  targetPkColumn: string;
  targetObjectType: string;
  targetSourceNamespace: string;
  sourceRole?: string;
  payload: Record<string, unknown>;
  valueOrigins: Record<string, CatalogValueOrigin>;
  sourceBindings: Record<string, string>;
  referenceBindings: CatalogProjectionReferenceBinding[];
  approvalKind?: "OCCURRENCE_CROSSWALK" | "CATALOG_PROVENANCE" | "RULE_PROVENANCE" | "SOURCE_DIRECT";
  approvalSha256?: string;
}

export interface CatalogProjectionSourceDirective {
  sourceLocatorSha256: string;
  sourcePayloadFingerprint: string;
  recordDomain: string;
  decisionStatus: CatalogDecisionStatus;
  decisionReason?: string;
  outputs: CatalogProjectionOutputDirective[];
}

export interface CatalogProjectionManifest {
  format: "hoibot-catalog-projection-manifest-v1";
  catalogVersion: "SC-20260902-1";
  commonStagingRunId: string;
  commonStagingSha256: string;
  commonStagingEnvelope: { rawBundleSha256: string; snapshotManifestSha256: string; extractionManifestSha256: string; expectedFileCount: number; expectedTotalBytes: string; projectedFileCount: number; ignoredFileCount: number; };
  targetSchemaSha256: string;
  actor: string;
  sources: CatalogProjectionSourceDirective[];
}

export interface CatalogTargetSchemaColumn {
  table: string;
  column: string;
  sqlType: string;
  nullable: boolean;
}

export interface CatalogGeneratedIdentityBinding {
  targetTable: string;
  targetPkColumn: string;
  objectType: string;
  sourceNamespace: string;
}

export interface CatalogReusedIdentityBinding {
  targetTable: string;
  targetPkColumn: string;
  sourceTable: string;
  sourceColumn: string;
}

export interface CatalogForeignKeyBinding {
  table: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface CatalogProjectionPolicy {
  targetSchemaSha256: string;
  columns: CatalogTargetSchemaColumn[];
  generatedCuidBindings: CatalogGeneratedIdentityBinding[];
  reusedPrimaryKeys: CatalogReusedIdentityBinding[];
  foreignKeys: CatalogForeignKeyBinding[];
  domainTargets: Record<string, string[]>;
  quarantineReasons: string[];
}

export interface CatalogProjectedRecord {
  projectionLocator: string;
  identityLocatorSha256: string;
  identityMode: CatalogIdentityMode;
  targetTable: string;
  targetPkColumn: string;
  targetObjectType: string;
  targetSourceNamespace: string;
  sourceRole: string | null;
  approvalKind: CatalogProjectionOutputDirective["approvalKind"] | null;
  approvalSha256: string | null;
  targetPayloadJson: string;
  targetPayloadFingerprint: string;
  valueOriginsJson: string;
  valueOriginsFingerprint: string;
  referenceBindingsJson: string;
  referenceBindingsFingerprint: string;
}

export interface CatalogProjectedDecision {
  sourceLocatorSha256: string;
  sourcePayloadFingerprint: string;
  recordDomain: string;
  decisionStatus: CatalogDecisionStatus;
  decisionReason: string | null;
  decisionFingerprint: string;
  outputs: CatalogProjectedRecord[];
}

export interface CatalogProjectionPlan {
  projectionManifestSha256: string;
  projectionSha256: string;
  decisions: CatalogProjectedDecision[];
}

export interface CatalogProjectionResult {
  catalogProjectionRunId: string;
  insertedDecisions: number;
  insertedProjectionRecords: number;
  replayed: boolean;
}

interface CommonRunRow { common_staging_run_id: string; raw_bundle_sha256: string; snapshot_manifest_sha256: string; extraction_manifest_sha256: string; staging_sha256: string; expected_file_count: number; expected_total_bytes: string; expected_record_count: number; projected_file_count: number; ignored_file_count: number; run_status: string; }
interface CommonRecordRow { common_staging_record_id: string; source_locator_sha256: string; payload_json: string; payload_fingerprint: string; record_domain: string; record_kind: string; projection_status: string; quarantine_reason: string | null; }
interface ProjectionRunRow { catalog_projection_run_id: string; raw_bundle_sha256: string; snapshot_manifest_sha256: string; extraction_manifest_sha256: string; expected_file_count: number; expected_total_bytes: string; projected_file_count: number; ignored_file_count: number; upstream_envelope_sha256: string; target_schema_sha256: string; projection_sha256: string; expected_source_count: number; projected_source_count: number; quarantined_source_count: number; ignored_source_count: number; projected_row_count: number; run_status: string; }
interface StoredDecisionRow { catalog_source_decision_id: string; common_staging_record_id: string; source_locator_sha256: string; source_payload_fingerprint: string; record_domain: string; decision_status: string; decision_reason: string | null; projected_row_count: number; decision_fingerprint: string; }
interface StoredProjectionRow { catalog_source_decision_id: string; projection_locator: string; identity_locator_sha256: string; identity_mode: string; target_table_name: string; target_pk_column_name: string; target_object_type: string; target_source_namespace: string; source_role: string | null; approval_kind: string | null; approval_sha256: string | null; target_payload_json: string; target_payload_fingerprint: string; value_origins_json: string; value_origins_fingerprint: string; reference_bindings_json: string; reference_bindings_fingerprint: string; }

const SHA256 = /^[0-9a-f]{64}$/;
const ASCII_TOKEN = /^[A-Za-z0-9_.-]+$/;
const OBJECT_TYPE = /^[A-Z][A-Z0-9_]{0,49}$/;
const INTEGER = /^-?(0|[1-9]\d*)$/;
const UNSIGNED_INTEGER = /^(0|[1-9]\d*)$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const KST_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const FORBIDDEN_PAYLOAD_KEY = /^(?:id|code|version|javascript|sql|script|handler_source|executable_payload)$/i;
const AUDIT_COLUMNS = new Set(["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);
const VALUE_ORIGINS = new Set<CatalogValueOrigin>(["SOURCE_EXACT", "SOURCE_ABSENT", "APPROVED_CATALOG", "EXPLICIT_RULE", "DERIVED_INDEX", "CONSTANT_CONTRACT"]);

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

// 카탈로그 투영 적재·rollback은 설계 또는 리허설 DB에서만 허용합니다.
export function assertCatalogProjectionDatabaseName(databaseName: string): void {
  if (databaseName !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(databaseName)) throw new Error("CATALOG_PROJECTION_OPERATIONAL_DATABASE_REFUSED");
}

// 키 순서에 독립적인 계약 fingerprint 문자열을 만듭니다.
function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("CATALOG_PROJECTION_UNSAFE_NUMBER");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  throw new Error("CATALOG_PROJECTION_UNSUPPORTED_VALUE");
}

function assertAscii(value: string, maxLength: number, code: string): void {
  if (value.length === 0 || value.length > maxLength || !ASCII_TOKEN.test(value)) throw new Error(code);
}

function assertReason(value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.length > 191 || !ASCII_TOKEN.test(value)) throw new Error("CATALOG_PROJECTION_DECISION_REASON_INVALID");
  return value;
}

function resolveJsonPointer(root: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === "") return { found: true, value: root };
  if (!pointer.startsWith("/")) return { found: false };
  let current: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(raw)) return { found: false };
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object") return { found: false };
    if (Array.isArray(current) && !/^(?:0|[1-9]\d*)$/.test(token)) return { found: false };
    if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false };
    current = (current as Record<string, unknown>)[token];
  }
  return { found: true, value: current };
}

function normalizeSourceValue(value: unknown): unknown {
  if (isLosslessNumber(value)) return value.toString();
  if (Array.isArray(value)) return value.map(normalizeSourceValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeSourceValue(child)]));
  return value;
}

function assertSourceValues(source: CommonRecordRow, directive: CatalogProjectionSourceDirective): void {
  let payload: unknown;
  try { payload = parseLossless(source.payload_json); } catch { throw new Error("CATALOG_PROJECTION_STAGING_PAYLOAD_INVALID"); }
  for (const output of directive.outputs) for (const [column, pointer] of Object.entries(output.sourceBindings)) {
    const actual = resolveJsonPointer(payload, pointer);
    if (output.valueOrigins[column] === "SOURCE_ABSENT") {
      if (actual.found) throw new Error("CATALOG_PROJECTION_SOURCE_ABSENT_MISMATCH");
    } else if (!actual.found || stableJson(normalizeSourceValue(actual.value)) !== stableJson(output.payload[column])) {
      throw new Error("CATALOG_PROJECTION_SOURCE_EXACT_MISMATCH");
    }
  }
}

export function assertCatalogProjectionSourceRole(recordKind: string, output: CatalogProjectionOutputDirective): void {
  if (output.targetTable === "canonical_owned_mini_pet_instances" && output.sourceRole !== recordKind) throw new Error("CATALOG_PROJECTION_MINI_PET_SOURCE_ROLE_MISMATCH");
}

function assertStringLength(value: unknown, maxLength: number, code: string): void {
  if (typeof value !== "string" || [...value].length > maxLength) throw new Error(code);
}

function assertSqlValue(column: CatalogTargetSchemaColumn, value: unknown, origin: CatalogValueOrigin): void {
  if (value === null) {
    if (!column.nullable || origin !== "SOURCE_ABSENT") throw new Error("CATALOG_PROJECTION_NULL_VALUE_INVALID");
    return;
  }
  if (origin === "SOURCE_ABSENT") throw new Error("CATALOG_PROJECTION_SOURCE_ABSENT_VALUE_INVALID");
  const type = column.sqlType.toUpperCase();
  if (type === "BOOLEAN") {
    if (typeof value !== "boolean") throw new Error("CATALOG_PROJECTION_BOOLEAN_INVALID");
  } else if (/^(?:TINYINT|INT|BIGINT) UNSIGNED$/.test(type)) {
    if (typeof value !== "string" || !UNSIGNED_INTEGER.test(value)) throw new Error("CATALOG_PROJECTION_UNSIGNED_INTEGER_INVALID");
    const bits = type.startsWith("TINYINT") ? 8n : type.startsWith("BIGINT") ? 64n : 32n;
    if (BigInt(value) > (1n << bits) - 1n) throw new Error("CATALOG_PROJECTION_INTEGER_RANGE_INVALID");
  } else if (/^(?:TINYINT|INT|BIGINT)$/.test(type)) {
    if (typeof value !== "string" || !INTEGER.test(value)) throw new Error("CATALOG_PROJECTION_INTEGER_INVALID");
    const bits = type === "TINYINT" ? 8n : type === "BIGINT" ? 64n : 32n;
    const numeric = BigInt(value);
    if (numeric < -(1n << (bits - 1n)) || numeric > (1n << (bits - 1n)) - 1n) throw new Error("CATALOG_PROJECTION_INTEGER_RANGE_INVALID");
  } else if (/^DECIMAL\(\d+,\d+\)$/.test(type)) {
    if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error("CATALOG_PROJECTION_DECIMAL_INVALID");
    const [, precisionText, scaleText] = /^DECIMAL\((\d+),(\d+)\)$/.exec(type)!;
    const precision = Number(precisionText); const scale = Number(scaleText);
    const [integerPart, fractionPart = ""] = value.replace(/^-/, "").split(".");
    if (fractionPart.length > scale || integerPart!.length > precision - scale) throw new Error("CATALOG_PROJECTION_DECIMAL_RANGE_INVALID");
  } else if (type === "JSON") {
    stableJson(value);
  } else if (type === "TEXT") {
    if (typeof value !== "string") throw new Error("CATALOG_PROJECTION_TEXT_INVALID");
  } else {
    const match = /^(?:VAR)?CHAR\((\d+)\)$/.exec(type);
    if (match === null) throw new Error("CATALOG_PROJECTION_SQL_TYPE_UNSUPPORTED");
    assertStringLength(value, Number(match[1]), "CATALOG_PROJECTION_STRING_INVALID");
    if (type === "CHAR(19)" && !KST_TIME.test(value as string)) throw new Error("CATALOG_PROJECTION_KST_TIME_INVALID");
  }
}

function targetColumns(policy: CatalogProjectionPolicy, table: string): CatalogTargetSchemaColumn[] {
  const columns = policy.columns.filter((column) => column.table === table);
  if (columns.length === 0) throw new Error("CATALOG_PROJECTION_TARGET_TABLE_UNKNOWN");
  return columns;
}

function validateIdentity(output: CatalogProjectionOutputDirective, policy: CatalogProjectionPolicy): void {
  assertAscii(output.targetTable, 100, "CATALOG_PROJECTION_TARGET_TABLE_INVALID");
  assertAscii(output.targetPkColumn, 100, "CATALOG_PROJECTION_TARGET_PK_INVALID");
  assertAscii(output.targetSourceNamespace, 100, "CATALOG_PROJECTION_SOURCE_NAMESPACE_INVALID");
  if (!OBJECT_TYPE.test(output.targetObjectType)) throw new Error("CATALOG_PROJECTION_OBJECT_TYPE_INVALID");
  if (output.identityMode === "GENERATED") {
    const expected = policy.generatedCuidBindings.find((binding) => binding.targetTable === output.targetTable && binding.targetPkColumn === output.targetPkColumn);
    if (expected === undefined || expected.objectType !== output.targetObjectType || expected.sourceNamespace !== output.targetSourceNamespace) throw new Error("CATALOG_PROJECTION_GENERATED_IDENTITY_CONTRACT_MISMATCH");
  } else if (output.identityMode === "REUSED") {
    const expected = policy.reusedPrimaryKeys.find((binding) => binding.targetTable === output.targetTable && binding.targetPkColumn === output.targetPkColumn);
    if (expected === undefined || output.targetObjectType !== "REUSED_PRIMARY_KEY" || output.targetSourceNamespace !== `object-import.reused.${output.targetTable}`) throw new Error("CATALOG_PROJECTION_REUSED_IDENTITY_CONTRACT_MISMATCH");
  } else {
    throw new Error("CATALOG_PROJECTION_IDENTITY_MODE_INVALID");
  }
}

function validatePayload(output: CatalogProjectionOutputDirective, policy: CatalogProjectionPolicy): void {
  const columns = targetColumns(policy, output.targetTable);
  const pk = columns.find((column) => column.column === output.targetPkColumn && column.sqlType === "CHAR(8)");
  if (pk === undefined) throw new Error("CATALOG_PROJECTION_TARGET_PK_SCHEMA_MISMATCH");
  const payloadKeys = Object.keys(output.payload).sort();
  const originKeys = Object.keys(output.valueOrigins).sort();
  if (payloadKeys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key) || AUDIT_COLUMNS.has(key))) throw new Error("CATALOG_PROJECTION_FORBIDDEN_PAYLOAD_KEY");
  if (stableJson(payloadKeys) !== stableJson(originKeys)) throw new Error("CATALOG_PROJECTION_VALUE_ORIGIN_COVERAGE_MISMATCH");
  const referenceColumns = new Map(output.referenceBindings.map((binding) => [binding.column, binding]));
  if (referenceColumns.size !== output.referenceBindings.length) throw new Error("CATALOG_PROJECTION_DUPLICATE_REFERENCE_BINDING");
  const expectedPayload = columns.filter((column) => column.column !== output.targetPkColumn && column.sqlType !== "CHAR(8)" && !AUDIT_COLUMNS.has(column.column));
  if (stableJson(payloadKeys) !== stableJson(expectedPayload.map((column) => column.column).sort())) throw new Error("CATALOG_PROJECTION_TARGET_COLUMN_COVERAGE_MISMATCH");
  const expectedReferences = columns.filter((column) => column.column !== output.targetPkColumn && column.sqlType === "CHAR(8)");
  if ([...referenceColumns.keys()].some((column) => !expectedReferences.some((expected) => expected.column === column))) throw new Error("CATALOG_PROJECTION_EXTRA_REFERENCE_BINDING");
  for (const column of expectedReferences) {
    const reference = referenceColumns.get(column.column);
    if (reference === undefined) {
      if (!column.nullable) throw new Error("CATALOG_PROJECTION_REQUIRED_REFERENCE_MISSING");
      continue;
    }
    if (!SHA256.test(reference.identityLocatorSha256)) throw new Error("CATALOG_PROJECTION_REFERENCE_LOCATOR_INVALID");
    const expectedForeignKey = policy.foreignKeys.find((candidate) => candidate.table === output.targetTable && candidate.column === column.column);
    if (expectedForeignKey === undefined || expectedForeignKey.referencesTable !== reference.targetTable || expectedForeignKey.referencesColumn !== reference.targetPkColumn) throw new Error("CATALOG_PROJECTION_REFERENCE_TARGET_INVALID");
    const targetPk = policy.columns.find((candidate) => candidate.table === reference.targetTable && candidate.column === reference.targetPkColumn && candidate.sqlType === "CHAR(8)");
    if (targetPk === undefined) throw new Error("CATALOG_PROJECTION_REFERENCE_TARGET_INVALID");
    if (reference.bindingScope === "APPROVED_CROSSWALK") {
      if (reference.approvalSha256 === undefined || !SHA256.test(reference.approvalSha256)) throw new Error("CATALOG_PROJECTION_CROSSWALK_APPROVAL_MISSING");
    } else if (reference.bindingScope !== "MANIFEST" || reference.approvalSha256 !== undefined) {
      throw new Error("CATALOG_PROJECTION_REFERENCE_SCOPE_INVALID");
    }
  }
  for (const key of payloadKeys) {
    const column = expectedPayload.find((candidate) => candidate.column === key)!;
    const origin = output.valueOrigins[key];
    if (origin === undefined || !VALUE_ORIGINS.has(origin)) throw new Error("CATALOG_PROJECTION_VALUE_ORIGIN_INVALID");
    assertSqlValue(column, output.payload[key], origin);
  }
  const sourceOriginKeys = payloadKeys.filter((key) => output.valueOrigins[key] === "SOURCE_EXACT" || output.valueOrigins[key] === "SOURCE_ABSENT").sort();
  if (stableJson(Object.keys(output.sourceBindings).sort()) !== stableJson(sourceOriginKeys)) throw new Error("CATALOG_PROJECTION_SOURCE_BINDING_COVERAGE_MISMATCH");
  for (const pointer of Object.values(output.sourceBindings)) if ((pointer !== "" && !pointer.startsWith("/")) || /~(?:[^01]|$)/.test(pointer)) throw new Error("CATALOG_PROJECTION_SOURCE_BINDING_POINTER_INVALID");
}

function assertApprovedOutput(output: CatalogProjectionOutputDirective): void {
  const requireOrigin = (column: string, expected: CatalogValueOrigin | CatalogValueOrigin[]): void => {
    const accepted = Array.isArray(expected) ? expected : [expected];
    if (column in output.payload && !accepted.includes(output.valueOrigins[column]!)) throw new Error("CATALOG_PROJECTION_DOMAIN_ORIGIN_INVALID");
  };
  if (output.targetTable === "object_furniture_definitions") {
    requireOrigin("purchase_price", "APPROVED_CATALOG");
    requireOrigin("charm_per_enhancement", "APPROVED_CATALOG");
    if ("rate" in output.payload) throw new Error("CATALOG_PROJECTION_FURNITURE_RATE_FORBIDDEN");
  }
  if (output.targetTable === "canonical_owned_mini_pet_instances") {
    if (output.approvalKind !== "OCCURRENCE_CROSSWALK" || output.approvalSha256 === undefined || !SHA256.test(output.approvalSha256)) throw new Error("CATALOG_PROJECTION_MINI_PET_OCCURRENCE_APPROVAL_REQUIRED");
    const binding = output.referenceBindings.find((reference) => reference.column === "mini_pet_id");
    if (binding?.bindingScope !== "APPROVED_CROSSWALK") throw new Error("CATALOG_PROJECTION_MINI_PET_DEFINITION_CROSSWALK_REQUIRED");
    if (output.sourceRole === "MINI_PET_BAG") {
      if (output.payload.equipped_flag !== false || output.payload.bound_flag !== false) throw new Error("CATALOG_PROJECTION_MINI_PET_BAG_STATE_INVALID");
    } else if (output.sourceRole === "MINI_PET_EQUIPPED") {
      if (output.payload.equipped_flag !== true || output.payload.bound_flag !== true) throw new Error("CATALOG_PROJECTION_MINI_PET_EQUIPPED_STATE_INVALID");
    } else {
      throw new Error("CATALOG_PROJECTION_MINI_PET_SOURCE_ROLE_REQUIRED");
    }
    if (output.valueOrigins.enhancement_level === "CONSTANT_CONTRACT" && output.payload.enhancement_level !== "0") throw new Error("CATALOG_PROJECTION_MINI_PET_DEFAULT_ENHANCEMENT_INVALID");
  }
  if (output.targetTable === "canonical_mini_pet_definitions") {
    for (const column of ["sale_price", "max_enhancement_level", "active_flag"]) requireOrigin(column, "APPROVED_CATALOG");
  }
  if (output.targetTable === "canonical_mini_pet_enhancement_rules") {
    for (const column of ["battle_charm_gain", "castle_charm_gain", "raid_charm_gain", "success_probability", "point_cost", "stone_quantity"]) requireOrigin(column, "APPROVED_CATALOG");
  }
  if (/^canonical_(?:member|pet|mini_pet)_title_definitions$/.test(output.targetTable)) requireOrigin("base_sale_price", "APPROVED_CATALOG");
  if (/^canonical_owned_(?:member|pet|mini_pet)_title_instances$/.test(output.targetTable)) requireOrigin("acquisition_price", ["SOURCE_EXACT", "SOURCE_ABSENT"]);
  if (output.targetTable === "canonical_owned_equipment_instances") requireOrigin("durability_amount", ["SOURCE_EXACT", "EXPLICIT_RULE"]);
  if (Object.values(output.valueOrigins).includes("APPROVED_CATALOG") && (output.approvalKind !== "CATALOG_PROVENANCE" || output.approvalSha256 === undefined || !SHA256.test(output.approvalSha256))) throw new Error("CATALOG_PROJECTION_CATALOG_APPROVAL_REQUIRED");
  if (Object.values(output.valueOrigins).includes("EXPLICIT_RULE") && (output.approvalKind !== "RULE_PROVENANCE" || output.approvalSha256 === undefined || !SHA256.test(output.approvalSha256))) throw new Error("CATALOG_PROJECTION_RULE_APPROVAL_REQUIRED");
}

function validateManifest(manifest: CatalogProjectionManifest, policy: CatalogProjectionPolicy): void {
  if (manifest.format !== "hoibot-catalog-projection-manifest-v1" || manifest.catalogVersion !== "SC-20260902-1") throw new Error("CATALOG_PROJECTION_FORMAT_MISMATCH");
  assertObjectIdentityCandidate(manifest.commonStagingRunId);
  if (!SHA256.test(manifest.commonStagingSha256) || !SHA256.test(manifest.targetSchemaSha256) || manifest.targetSchemaSha256 !== policy.targetSchemaSha256) throw new Error("CATALOG_PROJECTION_SCHEMA_HASH_MISMATCH");
  const envelope = manifest.commonStagingEnvelope;
  if (![envelope.rawBundleSha256, envelope.snapshotManifestSha256, envelope.extractionManifestSha256].every((value) => SHA256.test(value)) || !UNSIGNED_INTEGER.test(envelope.expectedTotalBytes) || ![envelope.expectedFileCount, envelope.projectedFileCount, envelope.ignoredFileCount].every(Number.isSafeInteger) || envelope.projectedFileCount + envelope.ignoredFileCount !== envelope.expectedFileCount) throw new Error("CATALOG_PROJECTION_STAGING_ENVELOPE_INVALID");
  createObjectAuditValues(manifest.actor);
  if (manifest.sources.length === 0) throw new Error("CATALOG_PROJECTION_SOURCE_COVERAGE_EMPTY");
  const locators = new Set<string>();
  const manifestIdentities = new Map<string, CatalogProjectionOutputDirective>();
  for (const source of manifest.sources) {
    if (!SHA256.test(source.sourceLocatorSha256) || !SHA256.test(source.sourcePayloadFingerprint)) throw new Error("CATALOG_PROJECTION_SOURCE_HASH_INVALID");
    if (locators.has(source.sourceLocatorSha256)) throw new Error("CATALOG_PROJECTION_DUPLICATE_SOURCE_LOCATOR");
    locators.add(source.sourceLocatorSha256);
    assertAscii(source.recordDomain, 50, "CATALOG_PROJECTION_RECORD_DOMAIN_INVALID");
    if (source.decisionStatus === "PROJECT") {
      if (source.decisionReason !== undefined || source.outputs.length === 0) throw new Error("CATALOG_PROJECTION_PROJECT_DECISION_INVALID");
    } else if (source.decisionStatus === "QUARANTINE" || source.decisionStatus === "IGNORE") {
      assertReason(source.decisionReason);
      if (source.decisionStatus === "QUARANTINE" && !policy.quarantineReasons.includes(source.decisionReason!)) throw new Error("CATALOG_PROJECTION_QUARANTINE_REASON_NOT_ALLOWED");
      if (source.decisionStatus === "IGNORE" && source.decisionReason !== "NOT_OBJECT_DOMAIN_INPUT") throw new Error("CATALOG_PROJECTION_IGNORE_REASON_NOT_ALLOWED");
      if (source.outputs.length !== 0) throw new Error("CATALOG_PROJECTION_NON_PROJECT_OUTPUT_FORBIDDEN");
    } else {
      throw new Error("CATALOG_PROJECTION_DECISION_STATUS_INVALID");
    }
    const outputKeys = new Set<string>();
    for (const output of source.outputs) {
      if (output.projectionLocator.length === 0 || output.projectionLocator.length > 191 || output.projectionLocator.includes("\0")) throw new Error("CATALOG_PROJECTION_OUTPUT_LOCATOR_INVALID");
      const outputKey = `${output.targetTable}\0${output.projectionLocator}`;
      if (outputKeys.has(outputKey)) throw new Error("CATALOG_PROJECTION_DUPLICATE_OUTPUT_LOCATOR");
      outputKeys.add(outputKey);
      validateIdentity(output, policy);
      if (!(policy.domainTargets[source.recordDomain.toLowerCase()] ?? []).includes(output.targetTable)) throw new Error("CATALOG_PROJECTION_DOMAIN_TARGET_MISMATCH");
      if (output.sourceRole !== undefined) assertAscii(output.sourceRole, 50, "CATALOG_PROJECTION_SOURCE_ROLE_INVALID");
      validatePayload(output, policy);
      assertApprovedOutput(output);
      if ((output.approvalKind === undefined) !== (output.approvalSha256 === undefined) || (output.approvalSha256 !== undefined && !SHA256.test(output.approvalSha256))) throw new Error("CATALOG_PROJECTION_APPROVAL_EVIDENCE_INVALID");
      const identityLocator = source.outputs.length === 1 ? source.sourceLocatorSha256 : sha256(`${source.sourceLocatorSha256}\0${output.projectionLocator}\0${output.targetTable}`);
      if (manifestIdentities.has(`${output.targetSourceNamespace}\0${identityLocator}`)) throw new Error("CATALOG_PROJECTION_DUPLICATE_TARGET_IDENTITY");
      manifestIdentities.set(`${output.targetSourceNamespace}\0${identityLocator}`, output);
    }
  }
  for (const source of manifest.sources) for (const output of source.outputs) for (const reference of output.referenceBindings) {
    if (reference.bindingScope === "MANIFEST") {
      const matching = [...manifestIdentities.entries()].find(([key, candidate]) => key.endsWith(`\0${reference.identityLocatorSha256}`) && candidate.targetTable === reference.targetTable && candidate.targetPkColumn === reference.targetPkColumn);
      if (matching === undefined) throw new Error("CATALOG_PROJECTION_MANIFEST_REFERENCE_UNRESOLVED");
    }
  }
}

// actor와 입력 배열 순서에 독립적인 projection manifest fingerprint를 계산합니다.
export function calculateCatalogProjectionManifestSha256(manifest: CatalogProjectionManifest, policy: CatalogProjectionPolicy): string {
  validateManifest(manifest, policy);
  const sources = [...manifest.sources].sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en")).map((source) => ({
    ...source,
    outputs: [...source.outputs].sort((left, right) => `${left.targetTable}\0${left.projectionLocator}`.localeCompare(`${right.targetTable}\0${right.projectionLocator}`, "en")).map((output) => ({ ...output, referenceBindings: [...output.referenceBindings].sort((left, right) => left.column.localeCompare(right.column, "en")) }))
  }));
  return sha256(stableJson({
    format: manifest.format,
    catalogVersion: manifest.catalogVersion,
    commonStagingRunId: manifest.commonStagingRunId,
    commonStagingSha256: manifest.commonStagingSha256,
    commonStagingEnvelope: manifest.commonStagingEnvelope,
    targetSchemaSha256: manifest.targetSchemaSha256,
    sources
  }));
}

// 검증된 manifest를 WBS742가 소비할 결정·typed row plan으로 변환합니다.
export function buildCatalogProjectionPlan(manifest: CatalogProjectionManifest, policy: CatalogProjectionPolicy): CatalogProjectionPlan {
  const projectionManifestSha256 = calculateCatalogProjectionManifestSha256(manifest, policy);
  const decisions = [...manifest.sources].sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en")).map((source): CatalogProjectedDecision => {
    const outputs = [...source.outputs].sort((left, right) => `${left.targetTable}\0${left.projectionLocator}`.localeCompare(`${right.targetTable}\0${right.projectionLocator}`, "en")).map((output): CatalogProjectedRecord => {
      const targetPayloadJson = stableJson(output.payload);
      const valueOriginsJson = stableJson(output.valueOrigins);
      const referenceBindingsJson = stableJson([...output.referenceBindings].sort((left, right) => left.column.localeCompare(right.column, "en")));
      return {
        projectionLocator: output.projectionLocator,
        identityLocatorSha256: source.outputs.length === 1 ? source.sourceLocatorSha256 : sha256(`${source.sourceLocatorSha256}\0${output.projectionLocator}\0${output.targetTable}`),
        identityMode: output.identityMode,
        targetTable: output.targetTable,
        targetPkColumn: output.targetPkColumn,
        targetObjectType: output.targetObjectType,
        targetSourceNamespace: output.targetSourceNamespace,
        sourceRole: output.sourceRole ?? null,
        approvalKind: output.approvalKind ?? null,
        approvalSha256: output.approvalSha256 ?? null,
        targetPayloadJson,
        targetPayloadFingerprint: sha256(targetPayloadJson),
        valueOriginsJson,
        valueOriginsFingerprint: sha256(valueOriginsJson),
        referenceBindingsJson,
        referenceBindingsFingerprint: sha256(referenceBindingsJson)
      };
    });
    const decisionBody = { sourceLocatorSha256: source.sourceLocatorSha256, sourcePayloadFingerprint: source.sourcePayloadFingerprint, recordDomain: source.recordDomain, decisionStatus: source.decisionStatus, decisionReason: source.decisionReason ?? null, outputs };
    return { ...decisionBody, decisionFingerprint: sha256(stableJson(decisionBody)) };
  });
  return { projectionManifestSha256, projectionSha256: sha256(stableJson(decisions)), decisions };
}

function isDatabaseDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "ER_DUP_ENTRY";
}

function isPrimaryDuplicate(error: unknown): boolean {
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return isDatabaseDuplicate(error) && /primary/i.test(message);
}

async function insertWithCuidRetry(transaction: DatabaseTransaction, sql: string, values: (candidate: string) => readonly unknown[]): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = createObjectIdentityCandidate();
    assertObjectIdentityCandidate(candidate);
    try {
      await transaction.execute(sql, values(candidate));
      return candidate;
    } catch (error) {
      if (!isPrimaryDuplicate(error)) throw error;
    }
  }
  throw new Error("CATALOG_PROJECTION_CUID_COLLISION_RETRY_EXHAUSTED");
}

// COMPLETE Common Staging run을 검증하고 전체 catalog projection을 한 transaction으로 적재합니다.
export class MariaCatalogProjectionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async project(manifest: CatalogProjectionManifest, policy: CatalogProjectionPolicy): Promise<CatalogProjectionResult> {
    const plan = buildCatalogProjectionPlan(manifest, policy);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.projectTransaction(manifest, plan);
      } catch (error) {
        if (attempt === 0 && isDatabaseDuplicate(error)) continue;
        throw error;
      }
    }
    throw new Error("CATALOG_PROJECTION_CONCURRENT_REPLAY_UNRESOLVED");
  }

  private async projectTransaction(manifest: CatalogProjectionManifest, plan: CatalogProjectionPlan): Promise<CatalogProjectionResult> {
    return this.database.withTransaction(async (transaction) => {
      const commonRun = (await transaction.query<CommonRunRow[]>("SELECT common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE common_staging_run_id=? FOR UPDATE", [manifest.commonStagingRunId]))[0];
      if (commonRun === undefined || commonRun.run_status !== "COMPLETE") throw new Error("CATALOG_PROJECTION_STAGING_RUN_NOT_COMPLETE");
      const envelope = manifest.commonStagingEnvelope;
      if (commonRun.raw_bundle_sha256 !== envelope.rawBundleSha256 || commonRun.snapshot_manifest_sha256 !== envelope.snapshotManifestSha256 || commonRun.extraction_manifest_sha256 !== envelope.extractionManifestSha256 || Number(commonRun.expected_file_count) !== envelope.expectedFileCount || commonRun.expected_total_bytes !== envelope.expectedTotalBytes || Number(commonRun.projected_file_count) !== envelope.projectedFileCount || Number(commonRun.ignored_file_count) !== envelope.ignoredFileCount) throw new Error("CATALOG_PROJECTION_STAGING_ENVELOPE_MISMATCH");
      const upstreamEnvelopeSha256 = sha256(stableJson({ ...envelope, stagingSha256: manifest.commonStagingSha256 }));
      if (commonRun.staging_sha256 !== manifest.commonStagingSha256 || Number(commonRun.expected_record_count) !== plan.decisions.length) throw new Error("CATALOG_PROJECTION_STAGING_PARITY_MISMATCH");
      const commonRecords = await transaction.query<CommonRecordRow[]>("SELECT common_staging_record_id,source_locator_sha256,CAST(payload_json AS CHAR) payload_json,payload_fingerprint,record_domain,record_kind,projection_status,quarantine_reason FROM data_migration_common_staging_records WHERE common_staging_run_id=? ORDER BY source_locator_sha256 FOR UPDATE", [manifest.commonStagingRunId]);
      if (commonRecords.length !== plan.decisions.length) throw new Error("CATALOG_PROJECTION_SOURCE_COVERAGE_MISMATCH");
      const commonByLocator = new Map(commonRecords.map((record) => [record.source_locator_sha256, record]));
      for (const decision of plan.decisions) {
        const source = commonByLocator.get(decision.sourceLocatorSha256);
        if (source === undefined || source.payload_fingerprint !== decision.sourcePayloadFingerprint || source.record_domain !== decision.recordDomain) throw new Error("CATALOG_PROJECTION_SOURCE_RECORD_MISMATCH");
        assertSourceValues(source, manifest.sources.find((candidate) => candidate.sourceLocatorSha256 === decision.sourceLocatorSha256)!);
        for (const output of manifest.sources.find((candidate) => candidate.sourceLocatorSha256 === decision.sourceLocatorSha256)!.outputs) assertCatalogProjectionSourceRole(source.record_kind, output);
        if (source.projection_status === "QUARANTINE" && (decision.decisionStatus !== "QUARANTINE" || decision.decisionReason !== source.quarantine_reason)) throw new Error("CATALOG_PROJECTION_STAGING_QUARANTINE_MUST_PROPAGATE");
      }
      const prior = (await transaction.query<ProjectionRunRow[]>("SELECT catalog_projection_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,upstream_envelope_sha256,target_schema_sha256,projection_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status FROM data_migration_catalog_projection_runs WHERE common_staging_run_id=? AND catalog_version=? AND projection_manifest_sha256=? FOR UPDATE", [manifest.commonStagingRunId, manifest.catalogVersion, plan.projectionManifestSha256]))[0];
      if (prior !== undefined) {
        this.assertRunParity(prior, manifest, plan);
        await this.verifyStored(transaction, prior.catalog_projection_run_id, commonByLocator, plan);
        return { catalogProjectionRunId: prior.catalog_projection_run_id, insertedDecisions: 0, insertedProjectionRecords: 0, replayed: true };
      }
      const audit = createObjectAuditValues(manifest.actor);
      const counts = this.counts(plan);
      const runId = await insertWithCuidRetry(transaction, "INSERT INTO data_migration_catalog_projection_runs(catalog_projection_run_id,common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,expected_total_bytes,projected_file_count,ignored_file_count,upstream_envelope_sha256,catalog_version,projection_manifest_sha256,target_schema_sha256,projection_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PROJECTING',?,?,?,?)", (candidate) => [candidate, manifest.commonStagingRunId, envelope.rawBundleSha256, envelope.snapshotManifestSha256, envelope.extractionManifestSha256, envelope.expectedFileCount, envelope.expectedTotalBytes, envelope.projectedFileCount, envelope.ignoredFileCount, upstreamEnvelopeSha256, manifest.catalogVersion, plan.projectionManifestSha256, manifest.targetSchemaSha256, plan.projectionSha256, plan.decisions.length, counts.projected, counts.quarantined, counts.ignored, counts.rows, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      for (const decision of plan.decisions) {
        const source = commonByLocator.get(decision.sourceLocatorSha256)!;
        const decisionId = await this.insertDecision(transaction, runId, source.common_staging_record_id, decision, audit);
        for (const output of decision.outputs) await this.insertProjectionRecord(transaction, runId, decisionId, output, audit);
      }
      await transaction.execute("UPDATE data_migration_catalog_projection_runs SET run_status='COMPLETE',UPDATE_USER=?,UPDATE_TIME=? WHERE catalog_projection_run_id=?", [audit.UPDATE_USER, audit.UPDATE_TIME, runId]);
      await this.verifyStored(transaction, runId, commonByLocator, plan);
      return { catalogProjectionRunId: runId, insertedDecisions: plan.decisions.length, insertedProjectionRecords: counts.rows, replayed: false };
    });
  }

  async rollback(commonStagingRunId: string, catalogVersion: string, projectionManifestSha256: string): Promise<number> {
    assertObjectIdentityCandidate(commonStagingRunId);
    assertAscii(catalogVersion, 50, "CATALOG_PROJECTION_CATALOG_VERSION_INVALID");
    if (!SHA256.test(projectionManifestSha256)) throw new Error("CATALOG_PROJECTION_MANIFEST_HASH_INVALID");
    const result = await this.database.execute("DELETE FROM data_migration_catalog_projection_runs WHERE common_staging_run_id=? AND catalog_version=? AND projection_manifest_sha256=?", [commonStagingRunId, catalogVersion, projectionManifestSha256]);
    return Number(result.affectedRows);
  }

  private counts(plan: CatalogProjectionPlan): { projected: number; quarantined: number; ignored: number; rows: number } {
    return {
      projected: plan.decisions.filter((decision) => decision.decisionStatus === "PROJECT").length,
      quarantined: plan.decisions.filter((decision) => decision.decisionStatus === "QUARANTINE").length,
      ignored: plan.decisions.filter((decision) => decision.decisionStatus === "IGNORE").length,
      rows: plan.decisions.reduce((sum, decision) => sum + decision.outputs.length, 0)
    };
  }

  private assertRunParity(row: ProjectionRunRow, manifest: CatalogProjectionManifest, plan: CatalogProjectionPlan): void {
    const counts = this.counts(plan);
    if (row.raw_bundle_sha256 !== manifest.commonStagingEnvelope.rawBundleSha256 || row.snapshot_manifest_sha256 !== manifest.commonStagingEnvelope.snapshotManifestSha256 || row.extraction_manifest_sha256 !== manifest.commonStagingEnvelope.extractionManifestSha256 || Number(row.expected_file_count) !== manifest.commonStagingEnvelope.expectedFileCount || row.expected_total_bytes !== manifest.commonStagingEnvelope.expectedTotalBytes || Number(row.projected_file_count) !== manifest.commonStagingEnvelope.projectedFileCount || Number(row.ignored_file_count) !== manifest.commonStagingEnvelope.ignoredFileCount || row.upstream_envelope_sha256 !== sha256(stableJson({ ...manifest.commonStagingEnvelope, stagingSha256: manifest.commonStagingSha256 })) || row.target_schema_sha256 !== manifest.targetSchemaSha256 || row.projection_sha256 !== plan.projectionSha256 || Number(row.expected_source_count) !== plan.decisions.length || Number(row.projected_source_count) !== counts.projected || Number(row.quarantined_source_count) !== counts.quarantined || Number(row.ignored_source_count) !== counts.ignored || Number(row.projected_row_count) !== counts.rows || row.run_status !== "COMPLETE") throw new Error("CATALOG_PROJECTION_REPLAY_CONFLICT");
  }

  private async insertDecision(transaction: DatabaseTransaction, runId: string, commonRecordId: string, decision: CatalogProjectedDecision, audit: ObjectAuditValues): Promise<string> {
    return insertWithCuidRetry(transaction, "INSERT INTO data_migration_catalog_source_decisions(catalog_source_decision_id,catalog_projection_run_id,common_staging_record_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (candidate) => [candidate, runId, commonRecordId, decision.sourceLocatorSha256, decision.sourcePayloadFingerprint, decision.recordDomain, decision.decisionStatus, decision.decisionReason, decision.outputs.length, decision.decisionFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  private async insertProjectionRecord(transaction: DatabaseTransaction, runId: string, decisionId: string, output: CatalogProjectedRecord, audit: ObjectAuditValues): Promise<void> {
    await insertWithCuidRetry(transaction, "INSERT INTO data_migration_catalog_projection_records(catalog_projection_record_id,catalog_projection_run_id,catalog_source_decision_id,projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,target_payload_json,target_payload_fingerprint,value_origins_json,value_origins_fingerprint,reference_bindings_json,reference_bindings_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (candidate) => [candidate, runId, decisionId, output.projectionLocator, output.identityLocatorSha256, output.identityMode, output.targetTable, output.targetPkColumn, output.targetObjectType, output.targetSourceNamespace, output.sourceRole, output.approvalKind, output.approvalSha256, output.targetPayloadJson, output.targetPayloadFingerprint, output.valueOriginsJson, output.valueOriginsFingerprint, output.referenceBindingsJson, output.referenceBindingsFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  private async verifyStored(transaction: DatabaseTransaction, runId: string, commonByLocator: ReadonlyMap<string, CommonRecordRow>, plan: CatalogProjectionPlan): Promise<void> {
    const decisions = await transaction.query<StoredDecisionRow[]>("SELECT catalog_source_decision_id,common_staging_record_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint FROM data_migration_catalog_source_decisions WHERE catalog_projection_run_id=? ORDER BY source_locator_sha256", [runId]);
    if (decisions.length !== plan.decisions.length) throw new Error("CATALOG_PROJECTION_DB_PARITY_MISMATCH");
    const expectedOutputs = new Map<string, CatalogProjectedRecord[]>();
    for (let index = 0; index < decisions.length; index += 1) {
      const actual = decisions[index]!;
      const expected = plan.decisions[index]!;
      const common = commonByLocator.get(expected.sourceLocatorSha256)!;
      if (actual.common_staging_record_id !== common.common_staging_record_id || actual.source_locator_sha256 !== expected.sourceLocatorSha256 || actual.source_payload_fingerprint !== expected.sourcePayloadFingerprint || actual.record_domain !== expected.recordDomain || actual.decision_status !== expected.decisionStatus || actual.decision_reason !== expected.decisionReason || Number(actual.projected_row_count) !== expected.outputs.length || actual.decision_fingerprint !== expected.decisionFingerprint) throw new Error("CATALOG_PROJECTION_DB_PARITY_MISMATCH");
      expectedOutputs.set(actual.catalog_source_decision_id, expected.outputs);
    }
    const outputs = await transaction.query<StoredProjectionRow[]>("SELECT record.catalog_source_decision_id,record.projection_locator,record.identity_locator_sha256,record.identity_mode,record.target_table_name,record.target_pk_column_name,record.target_object_type,record.target_source_namespace,record.source_role,record.approval_kind,record.approval_sha256,CAST(record.target_payload_json AS CHAR) target_payload_json,record.target_payload_fingerprint,CAST(record.value_origins_json AS CHAR) value_origins_json,record.value_origins_fingerprint,CAST(record.reference_bindings_json AS CHAR) reference_bindings_json,record.reference_bindings_fingerprint FROM data_migration_catalog_projection_records record JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=record.catalog_source_decision_id WHERE decision.catalog_projection_run_id=? ORDER BY record.catalog_source_decision_id,record.target_table_name,record.projection_locator", [runId]);
    const expectedFlat = decisions.flatMap((decision) => (expectedOutputs.get(decision.catalog_source_decision_id) ?? []).map((output) => ({ decisionId: decision.catalog_source_decision_id, output }))).sort((left, right) => `${left.decisionId}\0${left.output.targetTable}\0${left.output.projectionLocator}`.localeCompare(`${right.decisionId}\0${right.output.targetTable}\0${right.output.projectionLocator}`, "en"));
    if (outputs.length !== expectedFlat.length || outputs.some((actual, index) => {
      const expected = expectedFlat[index];
      if (expected === undefined) return true;
      const output = expected.output;
      return actual.catalog_source_decision_id !== expected.decisionId || actual.projection_locator !== output.projectionLocator || actual.identity_locator_sha256 !== output.identityLocatorSha256 || actual.identity_mode !== output.identityMode || actual.target_table_name !== output.targetTable || actual.target_pk_column_name !== output.targetPkColumn || actual.target_object_type !== output.targetObjectType || actual.target_source_namespace !== output.targetSourceNamespace || actual.source_role !== output.sourceRole || actual.approval_kind !== output.approvalKind || actual.approval_sha256 !== output.approvalSha256 || actual.target_payload_json !== output.targetPayloadJson || actual.target_payload_fingerprint !== output.targetPayloadFingerprint || actual.value_origins_json !== output.valueOriginsJson || actual.value_origins_fingerprint !== output.valueOriginsFingerprint || actual.reference_bindings_json !== output.referenceBindingsJson || actual.reference_bindings_fingerprint !== output.referenceBindingsFingerprint;
    })) throw new Error("CATALOG_PROJECTION_DB_PARITY_MISMATCH");
  }
}
