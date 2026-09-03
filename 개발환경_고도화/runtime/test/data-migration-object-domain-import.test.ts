import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction, type DatabaseWriteResult } from "../src/database.js";
import { loadConfig } from "../src/config.js";
import { calculateCatalogTargetSchemaSha256 } from "../src/data-migration/catalog-projection-provider.js";
import { assertObjectDomainImportDatabaseName, assertObjectDomainImportUpstreamEnvelope, buildObjectDomainImportPlan, calculateObjectDomainImportComponentSemanticSha256, calculateObjectDomainImportContractSemanticSha256, calculateObjectDomainImportSemanticSha256, MariaObjectDomainImporter, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION, stableDomainImportJson, type DomainImportPolicy } from "../src/data-migration/object-domain-importer.js";

const base = "../../migration-control/contracts/";
const schemaBytes = readFileSync(new URL(`${base}object-domain-import-target-schema.v1.json`, import.meta.url));
const schema = JSON.parse(schemaBytes.toString("utf8")) as { catalogVersion: "SC-20260902-1"; tableCount: number; columnCount: number; columns: DomainImportPolicy["columns"] };
const identityText = readFileSync(new URL(`${base}object-domain-import-identity-bindings.v1.json`, import.meta.url), "utf8");
const objectModelText = readFileSync(new URL(`${base}object-data-model-standard.v1.json`, import.meta.url), "utf8");
const dispositionText = readFileSync(new URL(`${base}object-domain-import-disposition.v1.json`, import.meta.url), "utf8");
const fieldMapText = readFileSync(new URL(`${base}object-domain-import-field-map.v1.json`, import.meta.url), "utf8");
const identity = JSON.parse(identityText) as { generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] };
const objectModel = JSON.parse(objectModelText) as { registeredMigrations: string[]; tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const disposition = JSON.parse(dispositionText) as { definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[] };
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const contractBytes = readFileSync(new URL(`${base}data-migration-object-domain-import.v1.json`, import.meta.url));
const contract = JSON.parse(contractBytes.toString("utf8")) as { migration: string; directTargetCount: number; targetColumnCount: number; definitionTargetCount: number; componentSemanticSha256: DomainImportPolicy["contractComponentSemanticSha256"]; semanticHashPolicy: { projectionVersion: string; currentImportContractProjectionSha256: string; acceptedCompatibleImportContractSha256: string[]; preservedPre466FullDocumentComponentSha256: { objectModel: string; disposition: string } }; tables: Array<{ primaryKey: string; auditColumns: string[] }> };
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/data-migration-object-domain-import-v1.json", import.meta.url), "utf8")) as { directTargetCount: number; targetColumnCount: number; definitionTargetCount: number; syntheticProjectionRowCount: number; gate5SourceDecisionCount: number; gate6SourceDecisionCount: number; gate6ProjectedDecisionCount: number; gate6QuarantinedDecisionCount: number; gate6IgnoredDecisionCount: number; exactDisplayName: string; scenarios: string[] };
const migration = readFileSync(new URL("../migrations/460_data_migration_object_domain_import.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/rollback/460_data_migration_object_domain_import.rollback.sql", import.meta.url), "utf8");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const directTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
const importContractSha256 = calculateObjectDomainImportContractSemanticSha256(contractBytes.toString("utf8"));
const policy: DomainImportPolicy = {
  catalogVersion: schema.catalogVersion,
  targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaBytes.toString("utf8")),
  importContractSha256,
  acceptedImportContractSha256: [importContractSha256, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256],
  componentSemanticSha256: { identityBindings: calculateObjectDomainImportComponentSemanticSha256("identityBindings", identityText, directTargets), objectModel: calculateObjectDomainImportComponentSemanticSha256("objectModel", objectModelText, directTargets), disposition: calculateObjectDomainImportComponentSemanticSha256("disposition", dispositionText, directTargets), fieldMap: calculateObjectDomainImportComponentSemanticSha256("fieldMap", fieldMapText, directTargets) },
  contractComponentSemanticSha256: contract.componentSemanticSha256,
  columns: schema.columns,
  generatedBindings: identity.generatedCuidBindings,
  reusedBindings: identity.reusedPrimaryKeys,
  foreignKeys: objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
  directTargets,
  definitionTargets: disposition.definitionSeed,
  domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])),
  quarantineReasons: fieldMap.recordQuarantine
};
const H = (index: number): string => hash(`synthetic-${index}`);
const locatorByTable = new Map(directTargets.map((table, index) => [table, H(index + 100)]));

function sample(column: DomainImportPolicy["columns"][number]): unknown {
  if (column.nullable) return null;
  if (column.sqlType === "BOOLEAN") return false;
  if (/^(?:TINYINT|INT|BIGINT)(?: UNSIGNED)?$/.test(column.sqlType) || /^DECIMAL/.test(column.sqlType)) return "1";
  if (column.sqlType === "JSON") return {};
  if (column.sqlType === "CHAR(19)") return "2026-09-03 18:00:00";
  if (column.column.endsWith("_fingerprint")) return H(900);
  return "SYNTHETIC";
}

function output(table: string, index: number, decisionId: string, domain: string): any {
  const generated = policy.generatedBindings.find((row) => row.targetTable === table);
  const reused = policy.reusedBindings.find((row) => row.targetTable === table);
  const pk = generated?.targetPkColumn ?? reused!.targetPkColumn;
  const locator = reused === undefined ? locatorByTable.get(table)! : locatorByTable.get(reused.sourceTable)!;
  const fks = policy.foreignKeys.filter((fk) => fk.table === table && fk.column !== pk);
  const payload: Record<string, unknown> = {};
  const origins: Record<string, string> = {};
  for (const column of policy.columns.filter((candidate) => candidate.table === table && candidate.column !== pk && !fks.some((fk) => fk.column === candidate.column))) {
    payload[column.column] = sample(column);
    origins[column.column] = column.nullable ? "SOURCE_ABSENT" : "SOURCE_EXACT";
  }
  if (table === "canonical_item_definitions") payload.item_name = fixture.exactDisplayName;
  if (table === "object_furniture_definitions") for (const key of ["purchase_price", "charm_per_enhancement"]) origins[key] = "APPROVED_CATALOG";
  if (table === "canonical_mini_pet_definitions") { payload.sale_price = "0"; for (const key of ["sale_price", "max_enhancement_level", "active_flag"]) origins[key] = "APPROVED_CATALOG"; }
  if (table === "canonical_mini_pet_enhancement_rules") for (const key of ["battle_charm_gain", "castle_charm_gain", "raid_charm_gain", "success_probability", "point_cost", "stone_quantity"]) origins[key] = "APPROVED_CATALOG";
  if (/^canonical_(?:member|pet|mini_pet)_title_definitions$/.test(table)) origins.base_sale_price = "APPROVED_CATALOG";
  if (/^canonical_owned_(?:member|pet|mini_pet)_title_instances$/.test(table)) { payload.acquisition_price = null; origins.acquisition_price = "SOURCE_ABSENT"; payload.acquisition_sequence = "1"; payload.ownership_status = "owned"; }
  if (table === "canonical_owned_equipment_instances") { payload.durability_amount = "0"; origins.durability_amount = "EXPLICIT_RULE"; payload.ownership_status = "owned"; }
  if (table === "object_owned_furniture_instances") payload.ownership_status = "bag";
  if (table === "object_furniture_market_listings") payload.listing_status = "active";
  if (/^canonical_owned_(?:item|pet|equipment)_instances$/.test(table)) payload.ownership_status = "owned";
  if (table === "canonical_pet_skill_definitions") { payload.handler_key = "passive_modifier"; payload.options_json = { commands: ["/합성명령"], cooldownSeconds: "0" }; }
  if (table === "canonical_owned_mini_pet_instances") { payload.enhancement_level = "0"; origins.enhancement_level = "CONSTANT_CONTRACT"; payload.equipped_flag = false; payload.bound_flag = false; payload.ownership_status = "owned"; }
  if (table === "canonical_player_currency_balances") payload.balance_minor_amount = "7";
  if (table === "canonical_currency_operations") { payload.operation_kind = "INITIAL_IMPORT"; payload.operation_status = "completed"; payload.delta_minor_amount = "7"; payload.balance_after_minor_amount = "7"; }
  if (table === "canonical_currency_ledger_entries") { payload.sequence_number = "1"; payload.delta_minor_amount = "7"; payload.balance_after_minor_amount = "7"; }
  if (table === "canonical_building_definitions") { payload.floor_value = "1"; payload.active_flag = true; }
  if (table === "canonical_craft_recipe_definitions") payload.craft_recipe_kind = "item_exchange";
  if (table === "canonical_package_reward_groups") payload.selection_mode = "all";
  if (table === "canonical_package_reward_entries") payload.target_kind = "item";
  if (table === "canonical_package_reward_quarantines") { payload.target_kind = "item"; payload.quarantine_status = "open"; }
  const references = fks.map((fk) => {
    const approvedMiniPet = table === "canonical_owned_mini_pet_instances" && fk.column === "mini_pet_id";
    return { column: fk.column, targetTable: fk.referencesTable, targetPkColumn: fk.referencesColumn, identityLocatorSha256: locatorByTable.get(fk.referencesTable)!, bindingScope: approvedMiniPet ? "APPROVED_CROSSWALK" : "MANIFEST", ...(approvedMiniPet ? { approvalSha256: H(999) } : {}) };
  });
  const approved = Object.values(origins).includes("APPROVED_CATALOG");
  const explicit = Object.values(origins).includes("EXPLICIT_RULE");
  const miniOwned = table === "canonical_owned_mini_pet_instances";
  const approvalKind = miniOwned ? "OCCURRENCE_CROSSWALK" : approved ? "CATALOG_PROVENANCE" : explicit ? "RULE_PROVENANCE" : null;
  const targetPayloadJson = stableDomainImportJson(payload);
  const valueOriginsJson = stableDomainImportJson(origins);
  const referenceBindingsJson = stableDomainImportJson(references.sort((a, b) => a.column.localeCompare(b.column, "en")));
  return {
    catalog_projection_record_id: `r${String(index).padStart(7, "0")}`,
    catalog_source_decision_id: decisionId,
    projection_locator: `synthetic-${table}`,
    identity_locator_sha256: locator,
    identity_mode: generated === undefined ? "REUSED" : "GENERATED",
    target_table_name: table,
    target_pk_column_name: pk,
    target_object_type: generated?.objectType ?? "REUSED_PRIMARY_KEY",
    target_source_namespace: generated?.sourceNamespace ?? `object-import.reused.${table}`,
    source_role: miniOwned ? "MINI_PET_BAG" : null,
    approval_kind: approvalKind,
    approval_sha256: approvalKind === null ? null : H(998),
    target_payload_json: targetPayloadJson,
    target_payload_fingerprint: hash(targetPayloadJson),
    value_origins_json: valueOriginsJson,
    value_origins_fingerprint: hash(valueOriginsJson),
    reference_bindings_json: referenceBindingsJson,
    reference_bindings_fingerprint: hash(referenceBindingsJson),
    record_domain: domain.toUpperCase(),
    decision_status: "PROJECT"
  };
}

function completeInput(): { run: any; staging: any; decisions: any[]; rows: any[] } {
  const rows: any[] = [];
  const decisions: any[] = [];
  let rowIndex = 0;
  for (const mapping of fieldMap.mappings) {
    const decisionId = `d${String(decisions.length).padStart(7, "0")}`;
    const domainRows = mapping.targetTables.map((table) => output(table, rowIndex++, decisionId, mapping.domain));
    rows.push(...domainRows);
    const body: any = {
      sourceLocatorSha256: H(decisions.length), sourcePayloadFingerprint: H(decisions.length + 50), recordDomain: mapping.domain.toUpperCase(), decisionStatus: "PROJECT", decisionReason: null,
      outputs: domainRows.sort((a, b) => `${a.target_table_name}\0${a.projection_locator}`.localeCompare(`${b.target_table_name}\0${b.projection_locator}`, "en")).map((row) => ({ projectionLocator: row.projection_locator, identityLocatorSha256: row.identity_locator_sha256, identityMode: row.identity_mode, targetTable: row.target_table_name, targetPkColumn: row.target_pk_column_name, targetObjectType: row.target_object_type, targetSourceNamespace: row.target_source_namespace, sourceRole: row.source_role, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256, targetPayloadJson: row.target_payload_json, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsJson: row.value_origins_json, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsJson: row.reference_bindings_json, referenceBindingsFingerprint: row.reference_bindings_fingerprint }))
    };
    decisions.push({ catalog_source_decision_id: decisionId, source_locator_sha256: body.sourceLocatorSha256, source_payload_fingerprint: body.sourcePayloadFingerprint, record_domain: body.recordDomain, decision_status: body.decisionStatus, decision_reason: body.decisionReason, projected_row_count: domainRows.length, decision_fingerprint: hash(stableDomainImportJson(body)), staging_record_domain: body.recordDomain, record_kind: mapping.domain === "mini-pet" ? "MINI_PET_BAG" : "SYNTHETIC", staging_projection_status: "PROJECT", staging_quarantine_reason: null, staging_source_locator_sha256: body.sourceLocatorSha256, staging_payload_fingerprint: body.sourcePayloadFingerprint, projectedBody: body });
  }
  const staging = { common_staging_run_id: "s1234567", raw_bundle_sha256: H(811), snapshot_manifest_sha256: H(812), extraction_manifest_sha256: H(813), staging_sha256: H(814), expected_file_count: 2, expected_total_bytes: "100", projected_file_count: 2, ignored_file_count: 0, run_status: "COMPLETE" };
  const upstreamEnvelopeSha256 = hash(stableDomainImportJson({ expectedFileCount: staging.expected_file_count, expectedTotalBytes: staging.expected_total_bytes, extractionManifestSha256: staging.extraction_manifest_sha256, ignoredFileCount: staging.ignored_file_count, projectedFileCount: staging.projected_file_count, rawBundleSha256: staging.raw_bundle_sha256, snapshotManifestSha256: staging.snapshot_manifest_sha256, stagingSha256: staging.staging_sha256 }));
  const run = { catalog_projection_run_id: "p1234567", common_staging_run_id: staging.common_staging_run_id, catalog_version: policy.catalogVersion, projection_manifest_sha256: H(801), raw_bundle_sha256: staging.raw_bundle_sha256, snapshot_manifest_sha256: staging.snapshot_manifest_sha256, extraction_manifest_sha256: staging.extraction_manifest_sha256, expected_file_count: staging.expected_file_count, expected_total_bytes: staging.expected_total_bytes, projected_file_count: staging.projected_file_count, ignored_file_count: staging.ignored_file_count, target_schema_sha256: policy.targetSchemaSha256, projection_sha256: H(802), upstream_envelope_sha256: upstreamEnvelopeSha256, expected_source_count: decisions.length, projected_source_count: decisions.length, quarantined_source_count: 0, ignored_source_count: 0, projected_row_count: rows.length, run_status: "COMPLETE" };
  const input = { run, staging, decisions: decisions.map(({ projectedBody: _body, ...decision }) => decision), rows };
  makePackageGraphValid(input);
  refreshProjectionFingerprints(input);
  return input;
}

function refreshProjectionFingerprints(input: ReturnType<typeof completeInput>): void {
  const projected = input.decisions.map((decision) => {
    const outputs = input.rows.filter((row) => row.catalog_source_decision_id === decision.catalog_source_decision_id).sort((a, b) => `${a.target_table_name}\0${a.projection_locator}`.localeCompare(`${b.target_table_name}\0${b.projection_locator}`, "en")).map((row) => ({ projectionLocator: row.projection_locator, identityLocatorSha256: row.identity_locator_sha256, identityMode: row.identity_mode, targetTable: row.target_table_name, targetPkColumn: row.target_pk_column_name, targetObjectType: row.target_object_type, targetSourceNamespace: row.target_source_namespace, sourceRole: row.source_role, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256, targetPayloadJson: row.target_payload_json, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsJson: row.value_origins_json, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsJson: row.reference_bindings_json, referenceBindingsFingerprint: row.reference_bindings_fingerprint }));
    decision.projected_row_count = outputs.length;
    const body = { sourceLocatorSha256: decision.source_locator_sha256, sourcePayloadFingerprint: decision.source_payload_fingerprint, recordDomain: decision.record_domain, decisionStatus: decision.decision_status, decisionReason: decision.decision_reason, outputs };
    decision.decision_fingerprint = hash(stableDomainImportJson(body));
    return { ...body, decisionFingerprint: decision.decision_fingerprint };
  }).sort((a, b) => a.sourceLocatorSha256.localeCompare(b.sourceLocatorSha256, "en"));
  input.run.projected_row_count = input.rows.length;
  input.run.projection_sha256 = hash(stableDomainImportJson(projected));
}

function setRowPayload(row: any, changes: Record<string, unknown>): void {
  const payload = { ...JSON.parse(row.target_payload_json), ...changes };
  row.target_payload_json = stableDomainImportJson(payload);
  row.target_payload_fingerprint = hash(row.target_payload_json);
}

function setRowReferences(row: any, references: any[]): void {
  row.reference_bindings_json = stableDomainImportJson([...references].sort((left, right) => left.column.localeCompare(right.column, "en")));
  row.reference_bindings_fingerprint = hash(row.reference_bindings_json);
}

function makePackageGraphValid(input: { rows: any[] }): void {
  const packageDefinition = input.rows.find((row) => row.target_table_name === "canonical_package_definitions")!;
  const rewardEntry = input.rows.find((row) => row.target_table_name === "canonical_package_reward_entries")!;
  const nestedReward = input.rows.find((row) => row.target_table_name === "canonical_package_nested_rewards")!;
  const secondPackageLocator = H(950);
  const secondEntryLocator = H(951);
  const secondPackage = { ...packageDefinition, catalog_projection_record_id: "rpkgdef2", projection_locator: "synthetic-canonical_package_definitions-2", identity_locator_sha256: secondPackageLocator };
  const secondEntry = { ...rewardEntry, catalog_projection_record_id: "rpkgent2", projection_locator: "synthetic-canonical_package_reward_entries-2", identity_locator_sha256: secondEntryLocator };
  setRowPayload(rewardEntry, { target_kind: "item" });
  setRowPayload(secondEntry, { target_kind: "package", reward_order: "2" });
  nestedReward.identity_locator_sha256 = secondEntryLocator;
  nestedReward.projection_locator = "synthetic-canonical_package_nested_rewards-2";
  const nestedReferences = JSON.parse(nestedReward.reference_bindings_json) as any[];
  for (const reference of nestedReferences) {
    if (reference.column === "package_reward_entry_id") reference.identityLocatorSha256 = secondEntryLocator;
    if (reference.column === "package_id") reference.identityLocatorSha256 = secondPackageLocator;
  }
  setRowReferences(nestedReward, nestedReferences);
  input.rows.push(secondPackage, secondEntry);
}

function withQuarantineAndIgnore(input = completeInput()): typeof input {
  const extra = [
    { id: "dq000000", source: H(701), payload: H(702), domain: "FURNITURE", status: "QUARANTINE", reason: "DEFINITION_REFERENCE_MISSING" },
    { id: "di000000", source: H(703), payload: H(704), domain: "ITEM", status: "IGNORE", reason: "NOT_OBJECT_DOMAIN_INPUT" }
  ];
  for (const row of extra) {
    const body = { sourceLocatorSha256: row.source, sourcePayloadFingerprint: row.payload, recordDomain: row.domain, decisionStatus: row.status, decisionReason: row.reason, outputs: [] };
    input.decisions.push({ catalog_source_decision_id: row.id, source_locator_sha256: row.source, source_payload_fingerprint: row.payload, record_domain: row.domain, decision_status: row.status, decision_reason: row.reason, projected_row_count: 0, decision_fingerprint: hash(stableDomainImportJson(body)), staging_record_domain: row.domain, record_kind: "SYNTHETIC", staging_projection_status: row.status === "QUARANTINE" ? "QUARANTINE" : "PROJECT", staging_quarantine_reason: row.status === "QUARANTINE" ? row.reason : null, staging_source_locator_sha256: row.source, staging_payload_fingerprint: row.payload });
  }
  input.run.expected_source_count += 2; input.run.quarantined_source_count = 1; input.run.ignored_source_count = 1;
  refreshProjectionFingerprints(input);
  return input;
}

class DomainImportDatabase implements DatabaseClient {
  readonly writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  readonly identities = new Map<string, string>();
  readonly objectTypes = new Map<string, string>();
  readonly bindingFingerprints = new Map<string, string>();
  readonly targets = new Map<string, Map<string, Record<string, unknown>>>();
  readonly decisionReceipts: any[] = [];
  readonly receipts: any[] = [];
  prior: any;
  constructor(readonly input = completeInput()) {}
  async ping(): Promise<void> {}
  async verifyRollback(): Promise<boolean> { return true; }
  async close(): Promise<void> {}
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return work(this); }
  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    if (sql.includes("FROM data_migration_catalog_projection_runs")) return [this.input.run] as T;
    if (sql.includes("FROM data_migration_common_staging_runs")) return [this.input.staging] as T;
    if (sql.includes("FROM data_migration_catalog_source_decisions decision JOIN data_migration_common_staging_records")) return this.input.decisions as T;
    if (sql.includes("FROM data_migration_catalog_projection_records record JOIN")) return this.input.rows as T;
    if (sql.includes("FROM data_migration_object_domain_import_runs")) return (this.prior === undefined ? [] : [this.prior]) as T;
    if (sql.includes("FROM data_migration_object_domain_import_decisions")) return [...this.decisionReceipts].sort((a, b) => String(a.source_locator_sha256).localeCompare(String(b.source_locator_sha256), "en")) as T;
    if (sql.includes("FROM object_identity_crosswalks crosswalk JOIN object_identities")) {
      const key = `${String(values[0])}\0${String(values[1])}`;
      const objectIdentityId = this.identities.get(key);
      return (objectIdentityId === undefined ? [] : [{ object_identity_id: objectIdentityId, object_identity_crosswalk_id: `x${objectIdentityId.slice(1)}`, object_type: this.objectTypes.get(objectIdentityId), payload_fingerprint: this.bindingFingerprints.get(key), INSERT_USER: "object-domain-import", INSERT_TIME: "2026-09-03 18:00:00", UPDATE_USER: "object-domain-import", UPDATE_TIME: "2026-09-03 18:00:00" }]) as T;
    }
    if (sql.includes("FROM data_migration_object_domain_import_records")) {
      const ordered = this.receipts.map((receipt) => {
        const projection = this.input.rows.find((row) => row.catalog_projection_record_id === receipt.catalog_projection_record_id)!;
        return { ...receipt, projection_target_table_name: projection.target_table_name, projection_target_pk_column_name: projection.target_pk_column_name, projection_identity_locator_sha256: projection.identity_locator_sha256 };
      }).sort((a, b) => Number(a.import_order) - Number(b.import_order));
      return (sql.includes("ORDER BY") && sql.includes("DESC") ? ordered.reverse() : ordered) as T;
    }
    const target = /SELECT ([a-z_,]+) FROM ([a-z_]+) WHERE ([a-z_]+)=\?/.exec(sql);
    if (target !== null) {
      const row = this.targets.get(target[2]!)?.get(String(values[0]));
      return (row === undefined ? [] : [row]) as T;
    }
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  }
  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    this.writes.push({ sql, values });
    const deletedTarget = /^DELETE FROM ([a-z_]+) WHERE ([a-z_]+)=\?$/.exec(sql);
    if (deletedTarget !== null && !deletedTarget[1]!.startsWith("data_migration_")) {
      const removed = this.targets.get(deletedTarget[1]!)?.delete(String(values[0])) ?? false;
      return { affectedRows: removed ? 1n : 0n, insertId: 0n };
    }
    if (sql.startsWith("DELETE FROM data_migration_object_domain_import_runs")) {
      this.prior = undefined; this.receipts.length = 0; this.decisionReceipts.length = 0;
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.startsWith("INSERT INTO object_identities")) this.objectTypes.set(String(values[0]), String(values[1]));
    else if (sql.startsWith("INSERT INTO object_identity_crosswalks")) { const key = `${String(values[3])}\0${String(values[4])}`; this.identities.set(key, String(values[1])); this.bindingFingerprints.set(key, String(values[5])); }
    else if (sql.startsWith("INSERT INTO data_migration_object_domain_import_runs")) {
      this.prior = { object_domain_import_run_id: String(values[0]), catalog_projection_sha256: String(values[3]), upstream_envelope_sha256: String(values[4]), target_schema_sha256: String(values[5]), import_contract_sha256: String(values[6]), import_sha256: String(values[7]), expected_source_count: Number(values[8]), projected_source_count: Number(values[9]), quarantined_source_count: Number(values[10]), ignored_source_count: Number(values[11]), expected_row_count: Number(values[12]), imported_row_count: 0, run_status: "IMPORTING" };
    } else if (sql.startsWith("INSERT INTO data_migration_object_domain_import_decisions")) {
      this.decisionReceipts.push({ catalog_source_decision_id: String(values[2]), source_locator_sha256: String(values[3]), decision_status: String(values[4]), decision_reason: values[5] === null ? null : String(values[5]), projected_row_count: Number(values[6]), decision_fingerprint: String(values[7]) });
    } else if (sql.startsWith("INSERT INTO data_migration_object_domain_import_records")) {
      this.receipts.push({ catalog_projection_record_id: String(values[2]), target_table_name: String(values[3]), target_pk_column_name: String(values[4]), target_pk_value: String(values[5]), identity_locator_sha256: String(values[6]), import_order: Number(values[7]), binding_fingerprint: String(values[8]), imported_row_fingerprint: String(values[9]) });
    } else if (sql.startsWith("UPDATE data_migration_object_domain_import_runs")) {
      this.prior.imported_row_count = Number(values[0]); this.prior.run_status = "COMPLETE";
    } else {
      const target = /^INSERT INTO ([a-z_]+)\(([^)]+)\) VALUES/.exec(sql);
      if (target !== null && !target[1]!.startsWith("data_migration_object_domain_import_")) {
        const columns = target[2]!.split(",");
        const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
        const pk = policy.generatedBindings.find((binding) => binding.targetTable === target[1])?.targetPkColumn ?? policy.reusedBindings.find((binding) => binding.targetTable === target[1])!.targetPkColumn;
        const table = this.targets.get(target[1]!) ?? new Map<string, Record<string, unknown>>();
        table.set(String(row[pk]), row); this.targets.set(target[1]!, table);
      }
    }
    return { affectedRows: 1n, insertId: 0n };
  }
}

function rewriteCompleteRunAsPre466(database: DomainImportDatabase): void {
  assert.ok(database.prior);
  const plan = buildObjectDomainImportPlan(database.input.run, database.input.decisions, database.input.rows, policy);
  database.prior.import_contract_sha256 = OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256;
  database.prior.import_sha256 = hash(stableDomainImportJson({
    catalogProjectionRunId: database.input.run.catalog_projection_run_id,
    projectionManifestSha256: database.input.run.projection_manifest_sha256,
    projectionSha256: database.input.run.projection_sha256,
    upstreamEnvelopeSha256: database.input.run.upstream_envelope_sha256,
    targetSchemaSha256: policy.targetSchemaSha256,
    importContractSha256: OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256,
    decisions: plan.decisions.map((row) => ({ id: row.catalog_source_decision_id, fingerprint: row.decision_fingerprint })).sort((a, b) => a.id.localeCompare(b.id, "en")),
    rows: plan.rows.map((row) => ({ id: row.catalog_projection_record_id, fingerprint: row.bindingFingerprint }))
  }));
}

class RollbackDomainImportDatabase extends DomainImportDatabase {
  targetInsertCount = 0;
  override async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const identitySnapshot = new Map(this.identities);
    const typeSnapshot = new Map(this.objectTypes);
    const fingerprintSnapshot = new Map(this.bindingFingerprints);
    const targetSnapshot = new Map([...this.targets].map(([table, rows]) => [table, new Map([...rows].map(([id, row]) => [id, { ...row }]))]));
    const receiptLength = this.receipts.length;
    const decisionReceiptLength = this.decisionReceipts.length;
    const priorSnapshot = this.prior;
    try { return await work(this); } catch (error) {
      this.identities.clear(); for (const [key, value] of identitySnapshot) this.identities.set(key, value);
      this.objectTypes.clear(); for (const [key, value] of typeSnapshot) this.objectTypes.set(key, value);
      this.bindingFingerprints.clear(); for (const [key, value] of fingerprintSnapshot) this.bindingFingerprints.set(key, value);
      this.targets.clear(); for (const [key, value] of targetSnapshot) this.targets.set(key, value);
      this.receipts.length = receiptLength; this.decisionReceipts.length = decisionReceiptLength; this.prior = priorSnapshot;
      throw error;
    }
  }
  override async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    const target = /^INSERT INTO ([a-z_]+)\(/.exec(sql);
    if (target !== null && !target[1]!.startsWith("data_migration_") && !target[1]!.startsWith("object_identit")) {
      this.targetInsertCount += 1;
      if (this.targetInsertCount === 20) throw new Error("SYNTHETIC_TARGET_FAILURE");
    }
    return super.execute(sql, values);
  }
}

class BusinessUniqueConflictDatabase extends RollbackDomainImportDatabase {
  decisionInsertAttempts = 0;
  override async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    if (sql.startsWith("INSERT INTO data_migration_object_domain_import_decisions")) {
      this.decisionInsertAttempts += 1;
      throw Object.assign(new Error("Duplicate entry 'source' for key 'uq_primary_object_domain_import_decision_source'"), { code: "ER_DUP_ENTRY" });
    }
    return super.execute(sql, values);
  }
}

describe("object domain import Gate 3/4", () => {
  it("registers concrete PK/FK/audit schema and reverse rollback", () => {
    assert.equal(contract.migration, "460_data_migration_object_domain_import.sql");
    assert.deepEqual([schema.tableCount, schema.columnCount, disposition.definitionSeed.length], [45, 241, 23]);
    assert.deepEqual([contract.directTargetCount, contract.targetColumnCount, contract.definitionTargetCount], [45, 241, 23]);
    assert.deepEqual([fixture.directTargetCount, fixture.targetColumnCount, fixture.definitionTargetCount], [45, 241, 23]);
    assert.equal(fixture.syntheticProjectionRowCount, 47);
    assert.equal(new Set(directTargets).size, 45);
    assert.equal(identity.generatedCuidBindings.length, 40);
    assert.equal(identity.reusedPrimaryKeys.length, 5);
    assert.ok(objectModel.registeredMigrations.includes("460_data_migration_object_domain_import.sql"));
    for (const table of contract.tables) assert.deepEqual(table.auditColumns, ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);
    assert.doesNotMatch(migration, /^\s*id\s+/im);
    assert.doesNotMatch(migration, /\b(?:object_)?code\b/i);
    assert.match(rollback, /records;[\s\S]*decisions;[\s\S]*runs;/);
  });

  it("preflights every frozen direct target and orders 23 definition targets before ownership", () => {
    const input = withQuarantineAndIgnore();
    assert.doesNotThrow(() => assertObjectDomainImportUpstreamEnvelope(input.run, input.staging));
    const plan = buildObjectDomainImportPlan(input.run, input.decisions, input.rows, policy);
    assert.equal(plan.rows.length, 47);
    assert.equal(new Set(plan.rows.map((row) => row.target_table_name)).size, 45);
    const lastDefinition = Math.max(...plan.rows.map((row, index) => disposition.definitionSeed.includes(row.target_table_name) ? index : -1));
    const firstOwnership = Math.min(...plan.rows.map((row, index) => disposition.stateImport.includes(row.target_table_name) && row.target_table_name !== "canonical_players" ? index : Number.MAX_SAFE_INTEGER));
    assert.ok(lastDefinition < firstOwnership);
    assert.equal(plan.rows.find((row) => row.target_table_name === "canonical_item_definitions")!.payload.item_name, fixture.exactDisplayName);
    assert.deepEqual(plan.decisions.slice(-2).map((row) => row.decision_status), ["QUARANTINE", "IGNORE"]);
  });

  it("uses canonical semantic hashes across line endings and binds every contract component", () => {
    const schemaText = schemaBytes.toString("utf8");
    assert.equal(calculateCatalogTargetSchemaSha256(schemaText.replace(/\r?\n/g, "\n")), policy.targetSchemaSha256);
    assert.equal(calculateCatalogTargetSchemaSha256(schemaText.replace(/\r?\n/g, "\r\n")), policy.targetSchemaSha256);
    const contractText = contractBytes.toString("utf8");
    assert.equal(calculateObjectDomainImportContractSemanticSha256(contractText.replace(/\r?\n/g, "\n")), policy.importContractSha256);
    assert.equal(calculateObjectDomainImportContractSemanticSha256(contractText.replace(/\r?\n/g, "\r\n")), policy.importContractSha256);
    assert.equal(contract.semanticHashPolicy.projectionVersion, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION);
    assert.equal(contract.semanticHashPolicy.currentImportContractProjectionSha256, policy.importContractSha256);
    assert.deepEqual(policy.componentSemanticSha256, contract.componentSemanticSha256);
    const runtimeOnlyObjectModel = JSON.parse(objectModelText) as any;
    runtimeOnlyObjectModel.tables.push({ table: "canonical_runtime_only_probe", role: "operation", columns: [] });
    assert.equal(calculateObjectDomainImportComponentSemanticSha256("objectModel", JSON.stringify(runtimeOnlyObjectModel), directTargets), policy.componentSemanticSha256.objectModel);
    const runtimeOnlyDisposition = JSON.parse(dispositionText) as any;
    runtimeOnlyDisposition.runtimeOnly.push("canonical_runtime_only_probe");
    runtimeOnlyDisposition.objectContractMigrationBaseline.push("999_runtime_only_probe.sql");
    assert.equal(calculateObjectDomainImportComponentSemanticSha256("disposition", JSON.stringify(runtimeOnlyDisposition), directTargets), policy.componentSemanticSha256.disposition);
    const directDispositionDrift = structuredClone(runtimeOnlyDisposition);
    directDispositionDrift.definitionSeed = directDispositionDrift.definitionSeed.slice().reverse();
    assert.notEqual(calculateObjectDomainImportComponentSemanticSha256("disposition", JSON.stringify(directDispositionDrift), directTargets), policy.componentSemanticSha256.disposition);
    assert.deepEqual(contract.semanticHashPolicy.preservedPre466FullDocumentComponentSha256, {
      objectModel: "3243e74e6e444dcb57c5c592cadb8d3f439663d60fdc76b383aa376ace747647",
      disposition: "9a7aeee6a699e1d17b0a4223a00379dea3b893954b8ad94d8bec003ffe246609"
    });
    const pre466Contract = JSON.parse(contractText) as any;
    delete pre466Contract.semanticHashPolicy;
    pre466Contract.componentSemanticSha256.objectModel = contract.semanticHashPolicy.preservedPre466FullDocumentComponentSha256.objectModel;
    pre466Contract.componentSemanticSha256.disposition = contract.semanticHashPolicy.preservedPre466FullDocumentComponentSha256.disposition;
    assert.equal(calculateObjectDomainImportSemanticSha256(JSON.stringify(pre466Contract)), contract.semanticHashPolicy.acceptedCompatibleImportContractSha256[0]);
    const unversionedPolicy = JSON.parse(contractText) as any;
    unversionedPolicy.semanticHashPolicy.projectionVersion = "UNVERSIONED";
    assert.throws(() => calculateObjectDomainImportContractSemanticSha256(JSON.stringify(unversionedPolicy)), /SEMANTIC_HASH_POLICY_INVALID/);
    const broadCompatibility = JSON.parse(contractText) as any;
    broadCompatibility.semanticHashPolicy.acceptedCompatibleImportContractSha256.push(H(1888));
    assert.throws(() => calculateObjectDomainImportContractSemanticSha256(JSON.stringify(broadCompatibility)), /SEMANTIC_HASH_POLICY_INVALID/);
    const arbitraryCompatibility = JSON.parse(contractText) as any;
    arbitraryCompatibility.semanticHashPolicy.acceptedCompatibleImportContractSha256 = [H(1889)];
    assert.throws(() => calculateObjectDomainImportContractSemanticSha256(JSON.stringify(arbitraryCompatibility)), /SEMANTIC_HASH_POLICY_INVALID/);
    const missingCompatibility = JSON.parse(contractText) as any;
    missingCompatibility.semanticHashPolicy.acceptedCompatibleImportContractSha256 = [];
    assert.throws(() => calculateObjectDomainImportContractSemanticSha256(JSON.stringify(missingCompatibility)), /SEMANTIC_HASH_POLICY_INVALID/);
    const currentAsLegacy = JSON.parse(contractText) as any;
    currentAsLegacy.semanticHashPolicy.acceptedCompatibleImportContractSha256 = [policy.importContractSha256];
    assert.throws(() => calculateObjectDomainImportContractSemanticSha256(JSON.stringify(currentAsLegacy)), /SEMANTIC_HASH_POLICY_INVALID/);
    const importBehaviorDrift = JSON.parse(contractText) as any;
    importBehaviorDrift.transactionBoundary = "DRIFT";
    assert.throws(() => calculateObjectDomainImportContractSemanticSha256(JSON.stringify(importBehaviorDrift)), /CONTRACT_PROJECTION_DRIFT/);
    const driftPolicy = structuredClone(policy);
    driftPolicy.componentSemanticSha256.fieldMap = H(1400);
    const input = completeInput();
    assert.throws(() => buildObjectDomainImportPlan(input.run, input.decisions, input.rows, driftPolicy), /COMPONENT_CONTRACT_DRIFT/);
    for (const acceptedImportContractSha256 of [
      [],
      [policy.importContractSha256],
      [policy.importContractSha256, H(1900)],
      [policy.importContractSha256, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256, H(1901)],
      [policy.importContractSha256, policy.importContractSha256]
    ]) {
      assert.throws(() => buildObjectDomainImportPlan(input.run, input.decisions, input.rows, { ...policy, acceptedImportContractSha256 }), /COMPATIBLE_CONTRACT_POLICY_INVALID/);
    }
  });

  it("atomically imports all 45 targets and exact replay performs zero writes", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    const first = await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    assert.equal(first.insertedCanonicalRows, 47);
    assert.equal(first.insertedDecisionReceipts, fieldMap.mappings.length);
    const beforeReplay = database.writes.length;
    const replay = await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    assert.deepEqual(replay, { objectDomainImportRunId: first.objectDomainImportRunId, insertedCanonicalRows: 0, insertedDecisionReceipts: 0, replayed: true });
    assert.equal(database.writes.length, beforeReplay);
  });

  it("replays and rolls back the one explicitly accepted pre-466 COMPLETE contract identity", async () => {
    assert.deepEqual(contract.semanticHashPolicy.acceptedCompatibleImportContractSha256, [OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256]);
    assert.deepEqual(policy.acceptedImportContractSha256, [policy.importContractSha256, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256]);

    const replayDatabase = new DomainImportDatabase();
    const replayImporter = new MariaObjectDomainImporter(replayDatabase, () => new Date("2026-09-03T09:00:00Z"));
    const first = await replayImporter.importProjection(replayDatabase.input.run.catalog_projection_run_id, policy, "object-domain-import");
    rewriteCompleteRunAsPre466(replayDatabase);
    const beforeReplay = replayDatabase.writes.length;
    assert.equal((await replayImporter.importProjection(replayDatabase.input.run.catalog_projection_run_id, policy, "object-domain-import")).objectDomainImportRunId, first.objectDomainImportRunId);
    assert.equal(replayDatabase.writes.length, beforeReplay);

    const rollbackDatabase = new DomainImportDatabase();
    const rollbackImporter = new MariaObjectDomainImporter(rollbackDatabase, () => new Date("2026-09-03T09:00:00Z"));
    await rollbackImporter.importProjection(rollbackDatabase.input.run.catalog_projection_run_id, policy, "object-domain-import");
    rewriteCompleteRunAsPre466(rollbackDatabase);
    assert.equal(await rollbackImporter.rollback(rollbackDatabase.input.run.catalog_projection_run_id, policy), 1);

    const rejectedDatabase = new DomainImportDatabase();
    const rejectedImporter = new MariaObjectDomainImporter(rejectedDatabase, () => new Date("2026-09-03T09:00:00Z"));
    await rejectedImporter.importProjection(rejectedDatabase.input.run.catalog_projection_run_id, policy, "object-domain-import");
    rewriteCompleteRunAsPre466(rejectedDatabase);
    rejectedDatabase.prior.import_contract_sha256 = H(1777);
    const writeCount = rejectedDatabase.writes.length;
    await assert.rejects(() => rejectedImporter.importProjection(rejectedDatabase.input.run.catalog_projection_run_id, policy, "object-domain-import"), /CONTRACT_IDENTITY_INCOMPATIBLE/);
    await assert.rejects(() => rejectedImporter.rollback(rejectedDatabase.input.run.catalog_projection_run_id, policy), /CONTRACT_IDENTITY_INCOMPATIBLE/);
    assert.equal(rejectedDatabase.writes.length, writeCount);
  });

  it("compares database-scaled decimals without losing precision or treating scale as drift", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    const first = await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const receipt = database.receipts.find((row) => row.target_table_name === "canonical_mini_pet_enhancement_rules")!;
    database.targets.get(receipt.target_table_name)!.get(receipt.target_pk_value)!.success_probability = "1.0000000000";
    const beforeReplay = database.writes.length;
    assert.deepEqual(await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import"), {
      objectDomainImportRunId: first.objectDomainImportRunId, insertedCanonicalRows: 0, insertedDecisionReceipts: 0, replayed: true
    });
    assert.equal(database.writes.length, beforeReplay);
  });

  it("rolls back identities, targets, receipts and run together when one target fails", async () => {
    const database = new RollbackDomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await assert.rejects(() => importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import"), /SYNTHETIC_TARGET_FAILURE/);
    assert.equal(database.identities.size, 0);
    assert.equal(database.objectTypes.size, 0);
    assert.equal(database.targets.size, 0);
    assert.equal(database.decisionReceipts.length, 0);
    assert.equal(database.receipts.length, 0);
    assert.equal(database.prior, undefined);
  });

  it("does not retry a business UNIQUE conflict as a CUID primary-key collision", async () => {
    const database = new BusinessUniqueConflictDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await assert.rejects(() => importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import"), /uq_primary_object_domain_import_decision_source/);
    assert.equal(database.decisionInsertAttempts, 1);
    assert.equal(database.prior, undefined);
    assert.equal(database.targets.size, 0);
  });

  it("rolls back canonical targets in reverse order while preserving upstream and identity provenance", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const identityCount = database.identities.size;
    const projectionRun = database.input.run;
    assert.equal(await importer.rollback(database.input.run.catalog_projection_run_id, policy), 1);
    assert.equal([...database.targets.values()].reduce((count, rows) => count + rows.size, 0), 0);
    assert.equal(database.prior, undefined);
    assert.equal(database.receipts.length, 0);
    assert.equal(database.decisionReceipts.length, 0);
    assert.equal(database.identities.size, identityCount);
    assert.equal(database.input.run, projectionRun);
    const deletes = database.writes.filter((write) => /^DELETE FROM (?!data_migration_)/.test(write.sql));
    assert.equal(deletes.length, 47);
  });

  it("fails rollback before writes when a receipt is redirected to another allowed target", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const playerReceipt = database.receipts.find((receipt) => receipt.target_table_name === "canonical_players")!;
    const redirected = database.receipts.find((receipt) => receipt.target_table_name !== "canonical_players")!;
    redirected.target_table_name = "canonical_players";
    redirected.target_pk_column_name = "player_id";
    redirected.target_pk_value = playerReceipt.target_pk_value;
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.rollback(database.input.run.catalog_projection_run_id, policy), /REPLAY_RECEIPT_MISMATCH/);
    assert.equal(database.writes.length, writeCount);
  });

  it("fails rollback before writes when a receipt is missing", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    database.receipts.pop();
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.rollback(database.input.run.catalog_projection_run_id, policy), /REPLAY_RECEIPT_MISMATCH/);
    assert.equal(database.writes.length, writeCount);
    assert.equal([...database.targets.values()].reduce((count, rows) => count + rows.size, 0), 47);
  });

  it("fails rollback before writes when receipt import order is swapped", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const firstOrder = database.receipts[0]!.import_order;
    database.receipts[0]!.import_order = database.receipts[1]!.import_order;
    database.receipts[1]!.import_order = firstOrder;
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.rollback(database.input.run.catalog_projection_run_id, policy), /REPLAY_RECEIPT_MISMATCH/);
    assert.equal(database.writes.length, writeCount);
    assert.equal([...database.targets.values()].reduce((count, rows) => count + rows.size, 0), 47);
  });

  it("fails rollback before writes when a receipt points at another same-table PK", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const receipt = database.receipts.find((candidate) => candidate.target_table_name === "canonical_item_definitions")!;
    const projection = database.input.rows.find((candidate) => candidate.catalog_projection_record_id === receipt.catalog_projection_record_id)!;
    const otherPk = "a1234567";
    const table = database.targets.get(receipt.target_table_name)!;
    table.set(otherPk, { ...table.get(receipt.target_pk_value)!, [receipt.target_pk_column_name]: otherPk });
    receipt.target_pk_value = otherPk;
    receipt.imported_row_fingerprint = hash(stableDomainImportJson({ table: receipt.target_table_name, pkColumn: receipt.target_pk_column_name, pk: otherPk, payload: JSON.parse(projection.target_payload_json), references: {} }));
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.rollback(database.input.run.catalog_projection_run_id, policy), /REPLAY_IDENTITY_BINDING_MISMATCH/);
    assert.equal(database.writes.length, writeCount);
  });

  it("fails rollback before writes when a stored target fingerprint drifts", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    database.receipts[0]!.imported_row_fingerprint = H(1300);
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.rollback(database.input.run.catalog_projection_run_id, policy), /REPLAY_RECEIPT_MISMATCH/);
    assert.equal(database.writes.length, writeCount);
  });

  it("fails a replay when a previously imported canonical target is missing and performs zero writes", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const receipt = database.receipts[0]!;
    database.targets.get(receipt.target_table_name)!.delete(receipt.target_pk_value);
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import"), /REPLAY_TARGET_MISSING/);
    assert.equal(database.writes.length, writeCount);
  });

  it("fails a replay when a decision receipt is missing and performs zero writes", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    database.decisionReceipts.pop();
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import"), /REPLAY_DECISION_RECEIPT_MISMATCH/);
    assert.equal(database.writes.length, writeCount);
  });

  it("fails a replay when an imported canonical value drifts and performs zero writes", async () => {
    const database = new DomainImportDatabase();
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    await importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import");
    const receipt = database.receipts.find((row) => row.target_table_name === "canonical_item_definitions")!;
    database.targets.get(receipt.target_table_name)!.get(receipt.target_pk_value)!.item_name = "변조된 이름";
    const writeCount = database.writes.length;
    await assert.rejects(() => importer.importProjection(database.input.run.catalog_projection_run_id, policy, "object-domain-import"), /REPLAY_TARGET_DRIFT/);
    assert.equal(database.writes.length, writeCount);
  });

  it("fails closed on projection drift, unknown targets, mini-pet guesses and executable pet-skill options", () => {
    const drift = completeInput();
    drift.rows[0].target_payload_json = "{}";
    assert.throws(() => buildObjectDomainImportPlan(drift.run, drift.decisions, drift.rows, policy), /PROJECTION_FINGERPRINT_DRIFT/);
    const unknown = completeInput();
    unknown.rows[0].target_table_name = "unknown_objects";
    assert.throws(() => buildObjectDomainImportPlan(unknown.run, unknown.decisions, unknown.rows, policy), /TARGET_UNKNOWN/);
    const invalidType = completeInput();
    const item = invalidType.rows.find((row) => row.target_table_name === "canonical_item_definitions")!;
    const typedPayload = JSON.parse(item.target_payload_json);
    typedPayload.active_flag = "true";
    item.target_payload_json = stableDomainImportJson(typedPayload);
    item.target_payload_fingerprint = hash(item.target_payload_json);
    assert.throws(() => buildObjectDomainImportPlan(invalidType.run, invalidType.decisions, invalidType.rows, policy), /BOOLEAN_INVALID/);
    const mini = completeInput();
    const miniRow = mini.rows.find((row) => row.target_table_name === "canonical_owned_mini_pet_instances")!;
    miniRow.approval_kind = null;
    miniRow.approval_sha256 = null;
    assert.throws(() => buildObjectDomainImportPlan(mini.run, mini.decisions, mini.rows, policy), /MINI_PET_OCCURRENCE_APPROVAL_REQUIRED/);
    const skill = completeInput();
    const skillRow = skill.rows.find((row) => row.target_table_name === "canonical_pet_skill_definitions")!;
    const payload = JSON.parse(skillRow.target_payload_json);
    payload.options_json = { javascript: "danger()" };
    skillRow.target_payload_json = stableDomainImportJson(payload);
    skillRow.target_payload_fingerprint = hash(skillRow.target_payload_json);
    assert.throws(() => buildObjectDomainImportPlan(skill.run, skill.decisions, skill.rows, policy), /EXECUTABLE_PAYLOAD_FORBIDDEN/);
  });

  it("rejects staging-domain drift and values that violate frozen database checks", () => {
    const stagingDrift = completeInput();
    stagingDrift.decisions[0].staging_record_domain = "OTHER";
    assert.throws(() => buildObjectDomainImportPlan(stagingDrift.run, stagingDrift.decisions, stagingDrift.rows, policy), /STAGING_DECISION_DRIFT/);
    const invalidCheck = completeInput();
    const group = invalidCheck.rows.find((row) => row.target_table_name === "canonical_package_reward_groups")!;
    setRowPayload(group, { selection_mode: "synthetic" });
    refreshProjectionFingerprints(invalidCheck);
    assert.throws(() => buildObjectDomainImportPlan(invalidCheck.run, invalidCheck.decisions, invalidCheck.rows, policy), /DATABASE_CHECK_INVALID/);
    for (const table of ["canonical_owned_item_instances", "canonical_owned_pet_instances", "canonical_owned_equipment_instances"]) {
      const invalidOwnership = completeInput();
      const owned = invalidOwnership.rows.find((row) => row.target_table_name === table)!;
      setRowPayload(owned, { ownership_status: "unknown" });
      refreshProjectionFingerprints(invalidOwnership);
      assert.throws(() => buildObjectDomainImportPlan(invalidOwnership.run, invalidOwnership.decisions, invalidOwnership.rows, policy), /DATABASE_CHECK_INVALID/);
    }
  });

  it("requires an owned positive pet-skill stack for the same player and skill", () => {
    const input = completeInput();
    const stack = input.rows.find((row) => row.target_table_name === "canonical_owned_pet_skill_stacks")!;
    setRowPayload(stack, { quantity: "0" });
    refreshProjectionFingerprints(input);
    assert.throws(() => buildObjectDomainImportPlan(input.run, input.decisions, input.rows, policy), /PET_SKILL_STACK_REQUIRED/);
  });

  it("requires matching package typed extensions and rejects nested package cycles", () => {
    const mismatched = completeInput();
    const nested = mismatched.rows.find((row) => row.target_table_name === "canonical_package_nested_rewards")!;
    const entry = mismatched.rows.find((row) => row.target_table_name === "canonical_package_reward_entries" && row.identity_locator_sha256 === nested.identity_locator_sha256)!;
    setRowPayload(entry, { target_kind: "item" });
    refreshProjectionFingerprints(mismatched);
    assert.throws(() => buildObjectDomainImportPlan(mismatched.run, mismatched.decisions, mismatched.rows, policy), /PACKAGE_TYPED_EXTENSION_INVALID/);

    const cyclic = completeInput();
    const cyclicNested = cyclic.rows.find((row) => row.target_table_name === "canonical_package_nested_rewards")!;
    const group = cyclic.rows.find((row) => row.target_table_name === "canonical_package_reward_groups")!;
    const ownerPackage = (JSON.parse(group.reference_bindings_json) as any[]).find((reference) => reference.column === "package_id").identityLocatorSha256;
    const references = JSON.parse(cyclicNested.reference_bindings_json) as any[];
    references.find((reference) => reference.column === "package_id").identityLocatorSha256 = ownerPackage;
    setRowReferences(cyclicNested, references);
    refreshProjectionFingerprints(cyclic);
    assert.throws(() => buildObjectDomainImportPlan(cyclic.run, cyclic.decisions, cyclic.rows, policy), /PACKAGE_CYCLE/);
  });

  it("rejects a manifest relation that crosses player ownership", () => {
    const input = completeInput();
    const player = input.rows.find((row) => row.target_table_name === "canonical_players")!;
    const secondPlayerLocator = H(1200);
    input.rows.push({ ...player, catalog_projection_record_id: "r9999999", projection_locator: "synthetic-canonical_players-second", identity_locator_sha256: secondPlayerLocator });
    const ownedPet = input.rows.find((row) => row.target_table_name === "canonical_owned_pet_instances")!;
    const references = JSON.parse(ownedPet.reference_bindings_json);
    references.find((reference: any) => reference.column === "player_id").identityLocatorSha256 = secondPlayerLocator;
    ownedPet.reference_bindings_json = stableDomainImportJson(references);
    ownedPet.reference_bindings_fingerprint = hash(ownedPet.reference_bindings_json);
    refreshProjectionFingerprints(input);
    assert.throws(() => buildObjectDomainImportPlan(input.run, input.decisions, input.rows, policy), /CROSS_OWNER_REFERENCE/);
  });

  it("treats a title selection reused player PK as its implicit owner", () => {
    for (const scope of ["member", "pet", "mini_pet"]) {
      const input = completeInput();
      const player = input.rows.find((row) => row.target_table_name === "canonical_players")!;
      const secondPlayerLocator = H(1250);
      input.rows.push({ ...player, catalog_projection_record_id: `rtitle${scope}`, projection_locator: `synthetic-canonical_players-${scope}-title-owner`, identity_locator_sha256: secondPlayerLocator });
      const ownedTitle = input.rows.find((row) => row.target_table_name === `canonical_owned_${scope}_title_instances`)!;
      const references = JSON.parse(ownedTitle.reference_bindings_json) as any[];
      references.find((reference) => reference.column === "player_id").identityLocatorSha256 = secondPlayerLocator;
      setRowReferences(ownedTitle, references);
      refreshProjectionFingerprints(input);
      assert.throws(() => buildObjectDomainImportPlan(input.run, input.decisions, input.rows, policy), /CROSS_OWNER_REFERENCE/);
    }
  });

  it("keeps old migration-458 manifest identity separate and rejects migration-459 envelope drift", () => {
    const input = completeInput();
    const oldManifestHash = input.run.projection_manifest_sha256;
    const changed = structuredClone(input.staging);
    changed.expected_total_bytes = "101";
    assert.throws(() => assertObjectDomainImportUpstreamEnvelope(input.run, changed), /STAGING_ENVELOPE_MISMATCH|UPSTREAM_ENVELOPE_FINGERPRINT_DRIFT/);
    assert.equal(input.run.projection_manifest_sha256, oldManifestHash);
  });

  it("refuses operating database names", () => {
    assert.doesNotThrow(() => assertObjectDomainImportDatabaseName("hoibot_schema_design"));
    assert.doesNotThrow(() => assertObjectDomainImportDatabaseName("hoibot_rehearsal_wbs742"));
    assert.throws(() => assertObjectDomainImportDatabaseName("hoibot_prod"), /OPERATIONAL_DATABASE_REFUSED/);
  });
});

async function gate5TargetCount(database: DatabaseClient): Promise<number> {
  let count = 0;
  for (const table of directTargets) count += Number((await database.query<Array<{ row_count: bigint }>>(`SELECT COUNT(*) row_count FROM ${table}`))[0]!.row_count);
  return count;
}

interface Gate5DatabaseCounts {
  targets: number; identities: number; crosswalks: number; importRuns: number; importDecisions: number;
  importRecords: number; projectionRuns: number; projectionDecisions: number; projectionRecords: number;
}

async function gate5Counts(database: DatabaseClient): Promise<Gate5DatabaseCounts> {
  const scalar = async (sql: string): Promise<number> => Number((await database.query<Array<{ row_count: bigint }>>(sql))[0]!.row_count);
  return {
    targets: await gate5TargetCount(database),
    identities: await scalar("SELECT COUNT(*) row_count FROM object_identities"),
    crosswalks: await scalar("SELECT COUNT(*) row_count FROM object_identity_crosswalks"),
    importRuns: await scalar("SELECT COUNT(*) row_count FROM data_migration_object_domain_import_runs"),
    importDecisions: await scalar("SELECT COUNT(*) row_count FROM data_migration_object_domain_import_decisions"),
    importRecords: await scalar("SELECT COUNT(*) row_count FROM data_migration_object_domain_import_records"),
    projectionRuns: await scalar("SELECT COUNT(*) row_count FROM data_migration_catalog_projection_runs"),
    projectionDecisions: await scalar("SELECT COUNT(*) row_count FROM data_migration_catalog_source_decisions"),
    projectionRecords: await scalar("SELECT COUNT(*) row_count FROM data_migration_catalog_projection_records")
  };
}

async function gate5WriteCounters(database: DatabaseClient): Promise<Record<string, string>> {
  const rows = await database.query<Array<{ Variable_name: string; Value: string }>>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Com_insert','Com_update','Com_delete','Com_replace')");
  return Object.fromEntries(rows.map((row) => [row.Variable_name, String(row.Value)]));
}

async function seedGate5Projection(database: DatabaseClient, input: ReturnType<typeof completeInput>): Promise<void> {
  const audit = ["wbs742-gate5", "2026-09-03 18:00:00", "wbs742-gate5", "2026-09-03 18:00:00"];
  await database.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?)", [input.staging.common_staging_run_id, input.staging.raw_bundle_sha256, input.staging.snapshot_manifest_sha256, input.staging.extraction_manifest_sha256, input.staging.staging_sha256, input.staging.expected_file_count, input.staging.expected_total_bytes, input.decisions.length, input.staging.projected_file_count, input.staging.ignored_file_count, ...audit]);
  for (const [index, decision] of input.decisions.entries()) {
    const stagingRecordId = `s${String(index).padStart(7, "0")}`;
    await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?, 'LEGACY_JSON','wbs742-gate5',?,?, 'synthetic.json','','',?,NULL,0,NULL,?,?, 'PROJECT',NULL,NULL,NULL,'{}',?,?,?,?,?)", [stagingRecordId, input.staging.common_staging_run_id, H(1500 + index), H(1600 + index), decision.source_locator_sha256, decision.record_domain, decision.record_kind, decision.source_payload_fingerprint, ...audit]);
    decision.common_staging_record_id = stagingRecordId;
  }
  await database.execute("INSERT INTO data_migration_catalog_projection_runs(catalog_projection_run_id,common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,expected_total_bytes,projected_file_count,ignored_file_count,upstream_envelope_sha256,catalog_version,projection_manifest_sha256,target_schema_sha256,projection_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?)", [input.run.catalog_projection_run_id, input.run.common_staging_run_id, input.run.raw_bundle_sha256, input.run.snapshot_manifest_sha256, input.run.extraction_manifest_sha256, input.run.expected_file_count, input.run.expected_total_bytes, input.run.projected_file_count, input.run.ignored_file_count, input.run.upstream_envelope_sha256, input.run.catalog_version, input.run.projection_manifest_sha256, input.run.target_schema_sha256, input.run.projection_sha256, input.run.expected_source_count, input.run.projected_source_count, input.run.quarantined_source_count, input.run.ignored_source_count, input.run.projected_row_count, ...audit]);
  for (const decision of input.decisions) await database.execute("INSERT INTO data_migration_catalog_source_decisions(catalog_source_decision_id,catalog_projection_run_id,common_staging_record_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [decision.catalog_source_decision_id, input.run.catalog_projection_run_id, decision.common_staging_record_id, decision.source_locator_sha256, decision.source_payload_fingerprint, decision.record_domain, decision.decision_status, decision.decision_reason, decision.projected_row_count, decision.decision_fingerprint, ...audit]);
  for (const row of input.rows) await database.execute("INSERT INTO data_migration_catalog_projection_records(catalog_projection_record_id,catalog_projection_run_id,catalog_source_decision_id,projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,target_payload_json,target_payload_fingerprint,value_origins_json,value_origins_fingerprint,reference_bindings_json,reference_bindings_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.catalog_projection_record_id, input.run.catalog_projection_run_id, row.catalog_source_decision_id, row.projection_locator, row.identity_locator_sha256, row.identity_mode, row.target_table_name, row.target_pk_column_name, row.target_object_type, row.target_source_namespace, row.source_role, row.approval_kind, row.approval_sha256, row.target_payload_json, row.target_payload_fingerprint, row.value_origins_json, row.value_origins_fingerprint, row.reference_bindings_json, row.reference_bindings_fingerprint, ...audit]);
}

if (process.env.OBJECT_DOMAIN_GATE5_PHASE !== undefined) describe("object domain import isolated MariaDB preparation", () => {
  it(`runs ${process.env.OBJECT_DOMAIN_GATE5_PHASE} against the allowlisted rehearsal database`, async () => {
    const config = loadConfig();
    assertObjectDomainImportDatabaseName(config.database.name);
    assert.equal(config.database.host, "127.0.0.1");
    assert.equal(config.database.port, 3321);
    assert.equal(config.database.name, process.env.OBJECT_DOMAIN_GATE5_PHASE === "gate6-prepare" ? "hoibot_rehearsal_wbs742_gate6" : "hoibot_rehearsal_wbs742_gate5");
    const database = createDatabaseClient(config.database);
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-03T09:00:00Z"));
    try {
      if (process.env.OBJECT_DOMAIN_GATE5_PHASE === "prepare") {
        const input = completeInput();
        await seedGate5Projection(database, input);
        const baseline = await gate5Counts(database);
        await database.execute("CREATE TRIGGER trg_wbs742_gate5_failure BEFORE INSERT ON canonical_player_currency_balances FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WBS742_GATE5_FORCED_FAILURE'");
        await assert.rejects(() => importer.importProjection(input.run.catalog_projection_run_id, policy, "wbs742-gate5"), /WBS742_GATE5_FORCED_FAILURE/);
        await database.execute("DROP TRIGGER trg_wbs742_gate5_failure");
        assert.deepEqual(await gate5Counts(database), baseline);
        const first = await importer.importProjection(input.run.catalog_projection_run_id, policy, "wbs742-gate5");
        const after = await gate5Counts(database);
        assert.equal(first.insertedCanonicalRows, 47);
        assert.equal(new Set(input.rows.map((row) => row.target_table_name)).size, 45);
        assert.equal(after.targets - baseline.targets, 47);
        assert.deepEqual([after.importRuns, after.importDecisions, after.importRecords], [1, input.decisions.length, 47]);
        process.stdout.write(`GATE5_PREPARE ${JSON.stringify({ projectionRunId: input.run.catalog_projection_run_id, objectDomainImportRunId: first.objectDomainImportRunId, baseline, after })}\n`);
      } else if (process.env.OBJECT_DOMAIN_GATE5_PHASE === "gate6-prepare") {
        const input = withQuarantineAndIgnore();
        await seedGate5Projection(database, input);
        const baseline = await gate5Counts(database);
        const first = await importer.importProjection(input.run.catalog_projection_run_id, policy, "wbs742-gate6");
        const after = await gate5Counts(database);
        assert.deepEqual([first.insertedCanonicalRows, first.insertedDecisionReceipts, first.replayed], [fixture.syntheticProjectionRowCount, fixture.gate6SourceDecisionCount, false]);
        assert.deepEqual([after.targets, after.importRuns, after.importDecisions, after.importRecords], [fixture.syntheticProjectionRowCount, 1, fixture.gate6SourceDecisionCount, fixture.syntheticProjectionRowCount]);
        process.stdout.write(`GATE6_PREPARE ${JSON.stringify({ projectionRunId: input.run.catalog_projection_run_id, objectDomainImportRunId: first.objectDomainImportRunId, baseline, after })}\n`);
      } else if (process.env.OBJECT_DOMAIN_GATE5_PHASE === "replay-rollback") {
        const beforeReplay = await gate5Counts(database);
        const writesBeforeReplay = await gate5WriteCounters(database);
        const replay = await importer.importProjection("p1234567", policy, "wbs742-gate5-restart");
        assert.equal(replay.replayed, true);
        assert.deepEqual(await gate5Counts(database), beforeReplay);
        const writesAfterReplay = await gate5WriteCounters(database);
        assert.deepEqual(writesAfterReplay, writesBeforeReplay);
        assert.equal(await importer.rollback("p1234567", policy), 1);
        const afterRollback = await gate5Counts(database);
        assert.equal(afterRollback.targets, beforeReplay.targets - 47);
        assert.deepEqual([afterRollback.importRuns, afterRollback.importDecisions, afterRollback.importRecords], [0, 0, 0]);
        assert.deepEqual([afterRollback.projectionRuns, afterRollback.projectionDecisions, afterRollback.projectionRecords], [beforeReplay.projectionRuns, beforeReplay.projectionDecisions, beforeReplay.projectionRecords]);
        assert.deepEqual([afterRollback.identities, afterRollback.crosswalks], [beforeReplay.identities, beforeReplay.crosswalks]);
        process.stdout.write(`GATE5_REPLAY_ROLLBACK ${JSON.stringify({ replay, writesBeforeReplay, writesAfterReplay, beforeReplay, afterRollback })}\n`);
      } else throw new Error("OBJECT_DOMAIN_GATE5_PHASE_INVALID");
    } finally { await database.close(); }
  });
});
