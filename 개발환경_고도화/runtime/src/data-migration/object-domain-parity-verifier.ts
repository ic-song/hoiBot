import { createHash } from "node:crypto";
import type { DatabaseTransaction } from "../database.js";
import { assertObjectDomainImportPolicy, type DomainImportPolicy } from "./object-domain-importer.js";

interface ProjectionRunRow {
  common_staging_run_id: string; catalog_version: string; projection_manifest_sha256: string;
  target_schema_sha256: string; projection_sha256: string; upstream_envelope_sha256: string;
  catalog_projection_run_id: string; expected_source_count: number; projected_source_count: number;
  quarantined_source_count: number; ignored_source_count: number; projected_row_count: number; run_status: string;
}
interface DecisionRow {
  catalog_source_decision_id: string; source_locator_sha256: string; source_payload_fingerprint: string; record_domain: string; decision_status: string;
  decision_reason: string | null; projected_row_count: number; decision_fingerprint: string;
}
interface ProjectionRow {
  catalog_projection_record_id: string; catalog_source_decision_id: string; identity_locator_sha256: string;
  identity_mode: "GENERATED" | "REUSED"; target_table_name: string; target_pk_column_name: string;
  target_object_type: string; target_source_namespace: string; projection_locator: string; source_role: string | null;
  approval_kind: string | null; approval_sha256: string | null; target_payload_json: string; target_payload_fingerprint: string;
  value_origins_json: string; value_origins_fingerprint: string; reference_bindings_json: string; reference_bindings_fingerprint: string;
}
interface ReferenceBinding {
  column: string; targetTable: string; targetPkColumn: string; identityLocatorSha256: string;
  bindingScope: "MANIFEST" | "APPROVED_CROSSWALK";
}
interface CommonStagingRunRow {
  common_staging_run_id: string; raw_bundle_sha256: string; snapshot_manifest_sha256: string; extraction_manifest_sha256: string;
  staging_sha256: string; expected_file_count: number; expected_total_bytes: string; projected_file_count: number; ignored_file_count: number; run_status: string;
}
interface ImportRunRow {
  object_domain_import_run_id: string; catalog_version: string; catalog_projection_sha256: string; upstream_envelope_sha256: string;
  target_schema_sha256: string; import_contract_sha256: string; import_sha256: string; expected_source_count: number;
  projected_source_count: number; quarantined_source_count: number; ignored_source_count: number; run_status: string;
  expected_row_count: number; imported_row_count: number;
}
interface ImportRecordRow {
  catalog_projection_record_id: string; target_table_name: string; target_pk_column_name: string;
  target_pk_value: string; identity_locator_sha256: string; import_order: number; binding_fingerprint: string; imported_row_fingerprint: string;
}

export interface ObjectDomainParityResult {
  projectionRowCount: number; targetRowCount: number; directTargetCount: number; schemaFieldCount: number;
  comparedFieldValueCount: number; decisionCount: number; projectedDecisionCount: number;
  quarantinedDecisionCount: number; ignoredDecisionCount: number; projectionSha256: string; targetSha256: string;
  projectionTableCounts: Record<string, number>; targetTableCounts: Record<string, number>;
  lastDefinitionImportOrder: number; firstNonDefinitionImportOrder: number; rowDiffCount: 0;
}

export interface ObjectDomainParityExpectations {
  projectionRowCount: number;
  directTargetCount: number;
  schemaFieldCount: number;
  definitionTargetCount: number;
  comparedFieldValueCount: number;
}

export interface ObjectDomainParityImportFingerprintInput {
  catalogProjectionRunId: string; projectionManifestSha256: string; projectionSha256: string;
  upstreamEnvelopeSha256: string; targetSchemaSha256: string;
  decisions: ReadonlyArray<{ id: string; fingerprint: string }>;
  rows: ReadonlyArray<{ id: string; fingerprint: string }>;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const HASH = /^[0-9a-f]{64}$/;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

// 저장된 계약 identity를 포함해 importer와 동일한 import fingerprint를 계산합니다.
export function calculateObjectDomainParityImportSha256(input: ObjectDomainParityImportFingerprintInput, persistedImportContractSha256: string): string {
  return sha256(stable({
    catalogProjectionRunId: input.catalogProjectionRunId,
    projectionManifestSha256: input.projectionManifestSha256,
    projectionSha256: input.projectionSha256,
    upstreamEnvelopeSha256: input.upstreamEnvelopeSha256,
    targetSchemaSha256: input.targetSchemaSha256,
    importContractSha256: persistedImportContractSha256,
    decisions: [...input.decisions].sort((left, right) => left.id.localeCompare(right.id, "en")),
    rows: input.rows
  }));
}

// importer가 허용한 계약 identity만 인정하고 저장 fingerprint를 그 identity로 재검산합니다.
export function assertObjectDomainParityImportFingerprint(importRun: Pick<ImportRunRow, "import_contract_sha256" | "import_sha256">, policy: DomainImportPolicy, input: ObjectDomainParityImportFingerprintInput): void {
  if (!HASH.test(importRun.import_contract_sha256) || !policy.acceptedImportContractSha256.includes(importRun.import_contract_sha256)) throw new Error("OBJECT_DOMAIN_PARITY_IMPORT_CONTRACT_IDENTITY_INCOMPATIBLE");
  if (calculateObjectDomainParityImportSha256(input, importRun.import_contract_sha256) !== importRun.import_sha256) throw new Error("OBJECT_DOMAIN_PARITY_IMPORT_FINGERPRINT_DRIFT");
}

function parseObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("OBJECT_DOMAIN_PARITY_PAYLOAD_INVALID"); }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("OBJECT_DOMAIN_PARITY_PAYLOAD_INVALID");
  return parsed as Record<string, unknown>;
}

function parseReferences(value: string): ReferenceBinding[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_INVALID"); }
  if (!Array.isArray(parsed)) throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_INVALID");
  return parsed as ReferenceBinding[];
}

function canonicalDecimal(value: unknown): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (match === null) throw new Error("OBJECT_DOMAIN_PARITY_DECIMAL_INVALID");
  const integer = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const magnitude = fraction === "" ? integer : `${integer}.${fraction}`;
  return magnitude === "0" ? "0" : `${match[1]}${magnitude}`;
}

function canonicalValue(value: unknown, sqlType: string, stored: boolean): unknown {
  if (value === null) return null;
  if (sqlType === "BOOLEAN") return value === true || value === 1 || value === 1n || value === "1";
  if (sqlType === "JSON") {
    if (!stored || typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { throw new Error("OBJECT_DOMAIN_PARITY_JSON_INVALID"); }
  }
  if (/^(?:TINYINT|INT|BIGINT)(?: UNSIGNED)?$/.test(sqlType)) {
    try { return BigInt(String(value)).toString(); } catch { throw new Error("OBJECT_DOMAIN_PARITY_INTEGER_INVALID"); }
  }
  if (/^DECIMAL/.test(sqlType)) return canonicalDecimal(value);
  return value;
}

function identityKey(table: string, column: string, locator: string): string { return `${table}\0${column}\0${locator}`; }
function rowKey(table: string, pk: string): string { return `${table}\0${pk}`; }

export class ObjectDomainParityVerifier {
  async verify(transaction: DatabaseTransaction, catalogProjectionRunId: string, policy: DomainImportPolicy, expectations: ObjectDomainParityExpectations): Promise<ObjectDomainParityResult> {
    assertObjectDomainImportPolicy(policy);
    if (Object.values(expectations).some((value) => !Number.isSafeInteger(value) || value <= 0)
      || new Set(policy.directTargets).size !== expectations.directTargetCount
      || policy.directTargets.length !== expectations.directTargetCount
      || policy.columns.length !== expectations.schemaFieldCount
      || policy.definitionTargets.length !== expectations.definitionTargetCount) throw new Error("OBJECT_DOMAIN_PARITY_POLICY_SCOPE_INVALID");
    for (const key of ["identityBindings", "objectModel", "disposition", "fieldMap"] as const) if (!HASH.test(policy.componentSemanticSha256[key]) || policy.componentSemanticSha256[key] !== policy.contractComponentSemanticSha256[key]) throw new Error("OBJECT_DOMAIN_PARITY_COMPONENT_CONTRACT_DRIFT");
    for (const name of [...policy.directTargets, ...policy.columns.flatMap((column) => [column.table, column.column])]) if (!IDENTIFIER.test(name)) throw new Error("OBJECT_DOMAIN_PARITY_IDENTIFIER_INVALID");
    const run = (await transaction.query<ProjectionRunRow[]>("SELECT catalog_projection_run_id,common_staging_run_id,catalog_version,projection_manifest_sha256,target_schema_sha256,projection_sha256,upstream_envelope_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status FROM data_migration_catalog_projection_runs WHERE catalog_projection_run_id=?", [catalogProjectionRunId]))[0];
    if (run === undefined || run.run_status !== "COMPLETE" || run.catalog_version !== policy.catalogVersion || run.target_schema_sha256 !== policy.targetSchemaSha256 || !HASH.test(run.projection_manifest_sha256) || !HASH.test(run.projection_sha256) || !HASH.test(run.upstream_envelope_sha256) || Number(run.projected_row_count) !== expectations.projectionRowCount) throw new Error("OBJECT_DOMAIN_PARITY_PROJECTION_RUN_INVALID");
    const stagingRuns = await transaction.query<CommonStagingRunRow[]>("SELECT common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE common_staging_run_id=?", [run.common_staging_run_id]);
    if (stagingRuns.length !== 1 || stagingRuns[0]!.run_status !== "COMPLETE") throw new Error("OBJECT_DOMAIN_PARITY_STAGING_RUN_INVALID");
    const staging = stagingRuns[0]!;
    const upstreamEnvelopeSha256 = sha256(stable({ expectedFileCount: Number(staging.expected_file_count), expectedTotalBytes: String(staging.expected_total_bytes), extractionManifestSha256: staging.extraction_manifest_sha256, ignoredFileCount: Number(staging.ignored_file_count), projectedFileCount: Number(staging.projected_file_count), rawBundleSha256: staging.raw_bundle_sha256, snapshotManifestSha256: staging.snapshot_manifest_sha256, stagingSha256: staging.staging_sha256 }));
    if (upstreamEnvelopeSha256 !== run.upstream_envelope_sha256) throw new Error("OBJECT_DOMAIN_PARITY_UPSTREAM_ENVELOPE_DRIFT");
    const decisions = await transaction.query<DecisionRow[]>("SELECT catalog_source_decision_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint FROM data_migration_catalog_source_decisions WHERE catalog_projection_run_id=? ORDER BY catalog_source_decision_id", [catalogProjectionRunId]);
    const decisionCounts = { PROJECT: 0, QUARANTINE: 0, IGNORE: 0 };
    for (const decision of decisions) {
      if (!(decision.decision_status in decisionCounts)) throw new Error("OBJECT_DOMAIN_PARITY_DECISION_STATUS_INVALID");
      decisionCounts[decision.decision_status as keyof typeof decisionCounts] += 1;
      if (decision.decision_status !== "PROJECT" && Number(decision.projected_row_count) !== 0) throw new Error("OBJECT_DOMAIN_PARITY_DECISION_ROW_COUNT_INVALID");
    }
    if (decisions.length !== Number(run.expected_source_count) || decisionCounts.PROJECT !== Number(run.projected_source_count) || decisionCounts.QUARANTINE !== Number(run.quarantined_source_count) || decisionCounts.IGNORE !== Number(run.ignored_source_count)) throw new Error("OBJECT_DOMAIN_PARITY_DECISION_COUNT_MISMATCH");
    const rows = await transaction.query<ProjectionRow[]>("SELECT catalog_projection_record_id,catalog_source_decision_id,projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,CAST(target_payload_json AS CHAR) target_payload_json,target_payload_fingerprint,CAST(value_origins_json AS CHAR) value_origins_json,value_origins_fingerprint,CAST(reference_bindings_json AS CHAR) reference_bindings_json,reference_bindings_fingerprint FROM data_migration_catalog_projection_records WHERE catalog_projection_run_id=? ORDER BY catalog_projection_record_id", [catalogProjectionRunId]);
    if (rows.length !== expectations.projectionRowCount || new Set(rows.map((row) => row.catalog_projection_record_id)).size !== expectations.projectionRowCount) throw new Error("OBJECT_DOMAIN_PARITY_PROJECTION_COUNT_MISMATCH");
    for (const row of rows) if (sha256(row.target_payload_json) !== row.target_payload_fingerprint || sha256(row.value_origins_json) !== row.value_origins_fingerprint || sha256(row.reference_bindings_json) !== row.reference_bindings_fingerprint) throw new Error("OBJECT_DOMAIN_PARITY_PROJECTION_RECORD_FINGERPRINT_DRIFT");
    const projectedByDecision = new Map<string, number>();
    for (const row of rows) projectedByDecision.set(row.catalog_source_decision_id, (projectedByDecision.get(row.catalog_source_decision_id) ?? 0) + 1);
    for (const decision of decisions) if ((projectedByDecision.get(decision.catalog_source_decision_id) ?? 0) !== Number(decision.projected_row_count)) throw new Error("OBJECT_DOMAIN_PARITY_DECISION_ROW_COUNT_INVALID");

    const projectedDecisions = decisions.map((decision) => {
      const outputs = rows.filter((row) => row.catalog_source_decision_id === decision.catalog_source_decision_id).sort((left, right) => `${left.target_table_name}\0${left.projection_locator}`.localeCompare(`${right.target_table_name}\0${right.projection_locator}`, "en")).map((row) => ({ projectionLocator: row.projection_locator, identityLocatorSha256: row.identity_locator_sha256, identityMode: row.identity_mode, targetTable: row.target_table_name, targetPkColumn: row.target_pk_column_name, targetObjectType: row.target_object_type, targetSourceNamespace: row.target_source_namespace, sourceRole: row.source_role, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256, targetPayloadJson: row.target_payload_json, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsJson: row.value_origins_json, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsJson: row.reference_bindings_json, referenceBindingsFingerprint: row.reference_bindings_fingerprint }));
      const body = { sourceLocatorSha256: decision.source_locator_sha256, sourcePayloadFingerprint: decision.source_payload_fingerprint, recordDomain: decision.record_domain, decisionStatus: decision.decision_status, decisionReason: decision.decision_reason, outputs };
      if (sha256(stable(body)) !== decision.decision_fingerprint) throw new Error("OBJECT_DOMAIN_PARITY_DECISION_FINGERPRINT_DRIFT");
      return { ...body, decisionFingerprint: decision.decision_fingerprint };
    }).sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"));
    if (sha256(stable(projectedDecisions)) !== run.projection_sha256) throw new Error("OBJECT_DOMAIN_PARITY_PROJECTION_FINGERPRINT_DRIFT");

    const importRuns = await transaction.query<ImportRunRow[]>("SELECT object_domain_import_run_id,catalog_version,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status FROM data_migration_object_domain_import_runs WHERE catalog_projection_run_id=?", [catalogProjectionRunId]);
    if (importRuns.length !== 1) throw new Error("OBJECT_DOMAIN_PARITY_IMPORT_RUN_INVALID");
    const importRun = importRuns[0]!;
    if (importRun.run_status !== "COMPLETE" || importRun.catalog_version !== policy.catalogVersion || importRun.catalog_projection_sha256 !== run.projection_sha256 || importRun.upstream_envelope_sha256 !== run.upstream_envelope_sha256 || importRun.target_schema_sha256 !== policy.targetSchemaSha256 || !HASH.test(importRun.import_contract_sha256) || !policy.acceptedImportContractSha256.includes(importRun.import_contract_sha256) || Number(importRun.expected_source_count) !== decisions.length || Number(importRun.projected_source_count) !== decisionCounts.PROJECT || Number(importRun.quarantined_source_count) !== decisionCounts.QUARANTINE || Number(importRun.ignored_source_count) !== decisionCounts.IGNORE || Number(importRun.expected_row_count) !== expectations.projectionRowCount || Number(importRun.imported_row_count) !== expectations.projectionRowCount) throw new Error("OBJECT_DOMAIN_PARITY_IMPORT_RUN_INVALID");
    const decisionReceipts = await transaction.query<Array<Omit<DecisionRow, "source_payload_fingerprint" | "record_domain">>>("SELECT catalog_source_decision_id,source_locator_sha256,decision_status,decision_reason,projected_row_count,decision_fingerprint FROM data_migration_object_domain_import_decisions WHERE object_domain_import_run_id=? ORDER BY catalog_source_decision_id", [importRun.object_domain_import_run_id]);
    const expectedDecisionReceipts = decisions.map(({ catalog_source_decision_id, source_locator_sha256, decision_status, decision_reason, projected_row_count, decision_fingerprint }) => ({ catalog_source_decision_id, source_locator_sha256, decision_status, decision_reason, projected_row_count: Number(projected_row_count), decision_fingerprint }));
    if (stable(decisionReceipts.map((row) => ({ ...row, projected_row_count: Number(row.projected_row_count) }))) !== stable(expectedDecisionReceipts)) throw new Error("OBJECT_DOMAIN_PARITY_DECISION_RECEIPT_MISMATCH");

    const targetIds = new Map<string, string>();
    const resolveCrosswalk = async (table: string, pk: string, locator: string): Promise<string> => {
      const binding = policy.generatedBindings.find((candidate) => candidate.targetTable === table && candidate.targetPkColumn === pk);
      if (binding === undefined) throw new Error("OBJECT_DOMAIN_PARITY_CROSSWALK_POLICY_MISSING");
      const resolved = await transaction.query<Array<{ object_identity_id: string; object_type: string }>>("SELECT crosswalk.object_identity_id,identity.object_type FROM object_identity_crosswalks crosswalk JOIN object_identities identity ON identity.object_identity_id=crosswalk.object_identity_id WHERE crosswalk.source_system='LEGACY_JSON' AND crosswalk.source_namespace=? AND crosswalk.source_identifier=?", [binding.sourceNamespace, locator]);
      if (resolved.length !== 1 || resolved[0]!.object_type !== binding.objectType) throw new Error("OBJECT_DOMAIN_PARITY_CROSSWALK_MISMATCH");
      return resolved[0]!.object_identity_id;
    };
    for (const row of rows.filter((candidate) => candidate.identity_mode === "GENERATED")) {
      const binding = policy.generatedBindings.find((candidate) => candidate.targetTable === row.target_table_name && candidate.targetPkColumn === row.target_pk_column_name);
      if (binding === undefined || binding.objectType !== row.target_object_type || binding.sourceNamespace !== row.target_source_namespace) throw new Error("OBJECT_DOMAIN_PARITY_IDENTITY_POLICY_MISMATCH");
      targetIds.set(identityKey(row.target_table_name, row.target_pk_column_name, row.identity_locator_sha256), await resolveCrosswalk(row.target_table_name, row.target_pk_column_name, row.identity_locator_sha256));
    }
    for (const row of rows.filter((candidate) => candidate.identity_mode === "REUSED")) {
      const binding = policy.reusedBindings.find((candidate) => candidate.targetTable === row.target_table_name && candidate.targetPkColumn === row.target_pk_column_name);
      if (binding === undefined) throw new Error("OBJECT_DOMAIN_PARITY_REUSED_POLICY_MISSING");
      const sourceKey = identityKey(binding.sourceTable, binding.sourceColumn, row.identity_locator_sha256);
      const targetPk = targetIds.get(sourceKey) ?? await resolveCrosswalk(binding.sourceTable, binding.sourceColumn, row.identity_locator_sha256);
      targetIds.set(identityKey(row.target_table_name, row.target_pk_column_name, row.identity_locator_sha256), targetPk);
    }

    const expectedRows: Array<{ table: string; pk: string; values: Record<string, unknown>; projectionRecordId: string; identityLocatorSha256: string; payload: Record<string, unknown>; references: Record<string, string> }> = [];
    for (const row of rows) {
      if (!policy.directTargets.includes(row.target_table_name)) throw new Error("OBJECT_DOMAIN_PARITY_TARGET_UNKNOWN");
      const targetPk = targetIds.get(identityKey(row.target_table_name, row.target_pk_column_name, row.identity_locator_sha256));
      if (targetPk === undefined) throw new Error("OBJECT_DOMAIN_PARITY_TARGET_PK_UNRESOLVED");
      const references: Record<string, string> = {};
      const referenceBindings = parseReferences(row.reference_bindings_json);
      if (new Set(referenceBindings.map((reference) => reference.column)).size !== referenceBindings.length) throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_DUPLICATE");
      for (const reference of referenceBindings) {
        if (!IDENTIFIER.test(reference.column) || !IDENTIFIER.test(reference.targetTable) || !IDENTIFIER.test(reference.targetPkColumn) || (reference.bindingScope !== "MANIFEST" && reference.bindingScope !== "APPROVED_CROSSWALK")) throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_INVALID");
        const expectedForeignKey = policy.foreignKeys.find((candidate) => candidate.table === row.target_table_name && candidate.column === reference.column && candidate.referencesTable === reference.targetTable && candidate.referencesColumn === reference.targetPkColumn);
        if (expectedForeignKey === undefined || !policy.directTargets.includes(reference.targetTable)) throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_POLICY_MISMATCH");
        const value = reference.bindingScope === "MANIFEST"
          ? targetIds.get(identityKey(reference.targetTable, reference.targetPkColumn, reference.identityLocatorSha256))
          : await resolveCrosswalk(reference.targetTable, reference.targetPkColumn, reference.identityLocatorSha256);
        if (value === undefined) throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_UNRESOLVED");
        references[reference.column] = value;
      }
      const payload = parseObject(row.target_payload_json);
      const schema = policy.columns.filter((column) => column.table === row.target_table_name);
      const expectedPayloadColumns = schema.filter((column) => column.column !== row.target_pk_column_name && !policy.foreignKeys.some((candidate) => candidate.table === row.target_table_name && candidate.column === column.column)).map((column) => column.column).sort();
      if (stable(Object.keys(payload).sort()) !== stable(expectedPayloadColumns)) throw new Error("OBJECT_DOMAIN_PARITY_PAYLOAD_SCOPE_MISMATCH");
      const expectedReferenceColumns = policy.foreignKeys.filter((candidate) => candidate.table === row.target_table_name && candidate.column !== row.target_pk_column_name).map((candidate) => candidate.column).sort();
      if (stable(Object.keys(references).sort()) !== stable(expectedReferenceColumns)) throw new Error("OBJECT_DOMAIN_PARITY_REFERENCE_COVERAGE_MISMATCH");
      const source = { [row.target_pk_column_name]: targetPk, ...references, ...payload };
      const values = Object.fromEntries(schema.map((column) => [column.column, canonicalValue(source[column.column], column.sqlType, false)]));
      expectedRows.push({ table: row.target_table_name, pk: targetPk, values, projectionRecordId: row.catalog_projection_record_id, identityLocatorSha256: row.identity_locator_sha256, payload, references });
    }
    if (new Set(expectedRows.map((row) => rowKey(row.table, row.pk))).size !== expectedRows.length) throw new Error("OBJECT_DOMAIN_PARITY_EXPECTED_PK_DUPLICATE");
    const actualRows: Array<{ table: string; pk: string; values: Record<string, unknown> }> = [];
    for (const table of policy.directTargets) {
      const schema = policy.columns.filter((column) => column.table === table);
      const primaryKey = policy.generatedBindings.find((binding) => binding.targetTable === table)?.targetPkColumn ?? policy.reusedBindings.find((binding) => binding.targetTable === table)?.targetPkColumn;
      if (primaryKey === undefined || !schema.some((column) => column.column === primaryKey)) throw new Error("OBJECT_DOMAIN_PARITY_PK_POLICY_MISSING");
      const stored = await transaction.query<Array<Record<string, unknown>>>(`SELECT ${schema.map((column) => column.column).join(",")} FROM ${table} ORDER BY ${primaryKey}`);
      for (const storedRow of stored) actualRows.push({ table, pk: String(storedRow[primaryKey]), values: Object.fromEntries(schema.map((column) => [column.column, canonicalValue(storedRow[column.column], column.sqlType, true)])) });
    }
    const expectedByKey = new Map(expectedRows.map((row) => [rowKey(row.table, row.pk), row]));
    const actualByKey = new Map(actualRows.map((row) => [rowKey(row.table, row.pk), row]));
    for (const key of expectedByKey.keys()) if (!actualByKey.has(key)) throw new Error("OBJECT_DOMAIN_PARITY_TARGET_ROW_MISSING");
    for (const key of actualByKey.keys()) if (!expectedByKey.has(key)) throw new Error("OBJECT_DOMAIN_PARITY_TARGET_ROW_EXTRA");
    for (const [key, expected] of expectedByKey) if (stable(expected.values) !== stable(actualByKey.get(key)!.values)) throw new Error("OBJECT_DOMAIN_PARITY_TARGET_ROW_DRIFT");

    const importRecords = await transaction.query<ImportRecordRow[]>("SELECT catalog_projection_record_id,target_table_name,target_pk_column_name,target_pk_value,identity_locator_sha256,import_order,binding_fingerprint,imported_row_fingerprint FROM data_migration_object_domain_import_records WHERE object_domain_import_run_id=? ORDER BY import_order", [importRun.object_domain_import_run_id]);
    if (importRecords.length !== expectations.projectionRowCount || new Set(importRecords.map((record) => record.catalog_projection_record_id)).size !== expectations.projectionRowCount || new Set(importRecords.map((record) => rowKey(record.target_table_name, record.target_pk_value))).size !== expectations.projectionRowCount || importRecords.some((record, index) => Number(record.import_order) !== index)) throw new Error("OBJECT_DOMAIN_PARITY_IMPORT_ORDER_INVALID");
    const expectedByProjection = new Map(expectedRows.map((row) => [row.projectionRecordId, row]));
    for (const record of importRecords) {
      const expected = expectedByProjection.get(record.catalog_projection_record_id);
      const projection = rows.find((row) => row.catalog_projection_record_id === record.catalog_projection_record_id);
      const expectedPkColumn = policy.generatedBindings.find((binding) => binding.targetTable === expected?.table)?.targetPkColumn ?? policy.reusedBindings.find((binding) => binding.targetTable === expected?.table)?.targetPkColumn;
      const bindingFingerprint = projection === undefined ? undefined : sha256(stable({ targetTable: projection.target_table_name, targetPkColumn: projection.target_pk_column_name, targetObjectType: projection.target_object_type, targetSourceNamespace: projection.target_source_namespace, identityLocatorSha256: projection.identity_locator_sha256, targetPayloadFingerprint: projection.target_payload_fingerprint, valueOriginsFingerprint: projection.value_origins_fingerprint, referenceBindingsFingerprint: projection.reference_bindings_fingerprint, approvalKind: projection.approval_kind, approvalSha256: projection.approval_sha256 }));
      const importedRowFingerprint = expected === undefined || expectedPkColumn === undefined ? undefined : sha256(stable({ table: expected.table, pkColumn: expectedPkColumn, pk: expected.pk, payload: expected.payload, references: expected.references }));
      if (expected === undefined || record.target_table_name !== expected.table || record.target_pk_column_name !== expectedPkColumn || record.target_pk_value !== expected.pk || record.identity_locator_sha256 !== expected.identityLocatorSha256 || record.binding_fingerprint !== bindingFingerprint || record.imported_row_fingerprint !== importedRowFingerprint) throw new Error("OBJECT_DOMAIN_PARITY_IMPORT_RECORD_MISMATCH");
    }
    const definitionOrders = importRecords.filter((record) => policy.definitionTargets.includes(record.target_table_name)).map((record) => Number(record.import_order));
    const remainingOrders = importRecords.filter((record) => !policy.definitionTargets.includes(record.target_table_name)).map((record) => Number(record.import_order));
    if (definitionOrders.length === 0 || remainingOrders.length === 0 || Math.max(...definitionOrders) >= Math.min(...remainingOrders)) throw new Error("OBJECT_DOMAIN_PARITY_DEFINITION_ORDER_INVALID");
    assertObjectDomainParityImportFingerprint(importRun, policy, {
      catalogProjectionRunId,
      projectionManifestSha256: run.projection_manifest_sha256,
      projectionSha256: run.projection_sha256,
      upstreamEnvelopeSha256: run.upstream_envelope_sha256,
      targetSchemaSha256: policy.targetSchemaSha256,
      decisions: decisions.map((decision) => ({ id: decision.catalog_source_decision_id, fingerprint: decision.decision_fingerprint })),
      rows: importRecords.map((record) => ({ id: record.catalog_projection_record_id, fingerprint: record.binding_fingerprint }))
    });

    const canonicalExpected = expectedRows.map(({ table, pk, values }) => ({ table, pk, values })).sort((left, right) => rowKey(left.table, left.pk).localeCompare(rowKey(right.table, right.pk), "en"));
    const canonicalActual = actualRows.sort((left, right) => rowKey(left.table, left.pk).localeCompare(rowKey(right.table, right.pk), "en"));
    const projectionSha256 = sha256(stable(canonicalExpected));
    const targetSha256 = sha256(stable(canonicalActual));
    if (projectionSha256 !== targetSha256) throw new Error("OBJECT_DOMAIN_PARITY_HASH_MISMATCH");
    const schemaFields = new Set(expectedRows.flatMap((row) => Object.keys(row.values).map((column) => `${row.table}.${column}`)));
    const policySchemaFields = new Set(policy.columns.map((column) => `${column.table}.${column.column}`));
    if (policySchemaFields.size !== expectations.schemaFieldCount || schemaFields.size !== expectations.schemaFieldCount || [...schemaFields].some((field) => !policySchemaFields.has(field))) throw new Error("OBJECT_DOMAIN_PARITY_FIELD_COVERAGE_INVALID");
    const tableCounts = (values: Array<{ table: string }>): Record<string, number> => Object.fromEntries([...policy.directTargets].sort().map((table) => [table, values.filter((row) => row.table === table).length]));
    const projectionTableCounts = tableCounts(expectedRows);
    const targetTableCounts = tableCounts(actualRows);
    if (stable(projectionTableCounts) !== stable(targetTableCounts)) throw new Error("OBJECT_DOMAIN_PARITY_TABLE_COUNT_MISMATCH");
    const comparedFieldValueCount = expectedRows.reduce((count, row) => count + Object.keys(row.values).length, 0);
    if (comparedFieldValueCount !== expectations.comparedFieldValueCount) throw new Error("OBJECT_DOMAIN_PARITY_COMPARED_VALUE_COUNT_INVALID");
    return { projectionRowCount: expectedRows.length, targetRowCount: actualRows.length, directTargetCount: new Set(expectedRows.map((row) => row.table)).size, schemaFieldCount: schemaFields.size, comparedFieldValueCount, decisionCount: decisions.length, projectedDecisionCount: decisionCounts.PROJECT, quarantinedDecisionCount: decisionCounts.QUARANTINE, ignoredDecisionCount: decisionCounts.IGNORE, projectionTableCounts, targetTableCounts, lastDefinitionImportOrder: Math.max(...definitionOrders), firstNonDefinitionImportOrder: Math.min(...remainingOrders), projectionSha256, targetSha256, rowDiffCount: 0 };
  }
}
