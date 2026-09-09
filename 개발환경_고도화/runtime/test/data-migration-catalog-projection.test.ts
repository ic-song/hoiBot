import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  assertCatalogProjectionDatabaseName,
  assertCatalogProjectionSourceRole,
  buildCatalogProjectionPlan,
  calculateCatalogTargetSchemaSha256,
  calculateLegacyCatalogTargetSchemaSha256s,
  calculateCatalogProjectionManifestSha256,
  MariaCatalogProjectionRepository,
  type CatalogGeneratedIdentityBinding,
  type CatalogForeignKeyBinding,
  type CatalogProjectionManifest,
  type CatalogProjectionOutputDirective,
  type CatalogProjectionPolicy,
  type CatalogReusedIdentityBinding,
  type CatalogTargetSchemaColumn
} from "../src/data-migration/catalog-projection-provider.js";

const fixtureUrl = new URL("../../migration-control/fixtures/synthetic-relational/data-migration-catalog-projection-v1.json", import.meta.url);
const schemaUrl = new URL("../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url);
const bindingUrl = new URL("../../migration-control/contracts/object-domain-import-identity-bindings.v1.json", import.meta.url);
const contractUrl = new URL("../../migration-control/contracts/data-migration-catalog-projection.v1.json", import.meta.url);
const objectModelUrl = new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as CatalogProjectionManifest;
const schemaBytes = readFileSync(schemaUrl);
const schema = JSON.parse(schemaBytes.toString("utf8")) as { columns: CatalogTargetSchemaColumn[] };
const bindings = JSON.parse(readFileSync(bindingUrl, "utf8")) as { generatedCuidBindings: CatalogGeneratedIdentityBinding[]; reusedPrimaryKeys: CatalogReusedIdentityBinding[] };
const objectModel = JSON.parse(readFileSync(objectModelUrl, "utf8")) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const fieldMap = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-field-map.v1.json", import.meta.url), "utf8")) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const contract = JSON.parse(readFileSync(contractUrl, "utf8")) as { migration: string; tables: Array<{ primaryKey: string; auditColumns: string[] }>; domainDecisions: Record<string, unknown> };
const policy: CatalogProjectionPolicy = { targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaBytes.toString("utf8")), legacyTargetSchemaSha256s: calculateLegacyCatalogTargetSchemaSha256s(schemaBytes.toString("utf8")), columns: schema.columns, generatedCuidBindings: bindings.generatedCuidBindings, reusedPrimaryKeys: bindings.reusedPrimaryKeys, foreignKeys: objectModel.tables.flatMap((table): CatalogForeignKeyBinding[] => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))), domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])), quarantineReasons: fieldMap.recordQuarantine };
const migration = readFileSync(new URL("../migrations/458_data_migration_catalog_projection.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/rollback/458_data_migration_catalog_projection.rollback.sql", import.meta.url), "utf8");
const HASH = "9".repeat(64);
const upstreamEnvelopeSha256 = createHash("sha256").update(JSON.stringify({ expectedFileCount: fixture.commonStagingEnvelope.expectedFileCount, expectedTotalBytes: fixture.commonStagingEnvelope.expectedTotalBytes, extractionManifestSha256: fixture.commonStagingEnvelope.extractionManifestSha256, ignoredFileCount: fixture.commonStagingEnvelope.ignoredFileCount, projectedFileCount: fixture.commonStagingEnvelope.projectedFileCount, rawBundleSha256: fixture.commonStagingEnvelope.rawBundleSha256, snapshotManifestSha256: fixture.commonStagingEnvelope.snapshotManifestSha256, stagingSha256: fixture.commonStagingSha256 })).digest("hex");

function sampleValue(column: CatalogTargetSchemaColumn): unknown {
  const type = column.sqlType.toUpperCase();
  if (type === "BOOLEAN") return false;
  if (/^(?:TINYINT|INT|BIGINT)(?: UNSIGNED)?$/.test(type) || /^DECIMAL/.test(type)) return "0";
  if (type === "JSON") return {};
  if (type === "CHAR(19)") return "2026-09-03 16:00:00";
  return "x";
}

function validOutput(targetTable: string): CatalogProjectionOutputDirective {
  const generated = bindings.generatedCuidBindings.find((binding) => binding.targetTable === targetTable);
  const reused = bindings.reusedPrimaryKeys.find((binding) => binding.targetTable === targetTable);
  if (generated === undefined && reused === undefined) throw new Error(`missing identity binding for ${targetTable}`);
  const targetPkColumn = generated?.targetPkColumn ?? reused!.targetPkColumn;
  const columns = schema.columns.filter((column) => column.table === targetTable);
  const payload: Record<string, unknown> = {};
  const valueOrigins: CatalogProjectionOutputDirective["valueOrigins"] = {};
  const referenceBindings: CatalogProjectionOutputDirective["referenceBindings"] = [];
  const sourceBindings: CatalogProjectionOutputDirective["sourceBindings"] = {};
  for (const column of columns) {
    if (column.column === targetPkColumn) continue;
    if (column.sqlType === "CHAR(8)") {
      const foreignKey = policy.foreignKeys.find((candidate) => candidate.table === targetTable && candidate.column === column.column);
      if (foreignKey === undefined) throw new Error(`missing FK for ${targetTable}.${column.column}`);
      referenceBindings.push({ column: column.column, targetTable: foreignKey.referencesTable, targetPkColumn: foreignKey.referencesColumn, identityLocatorSha256: HASH, bindingScope: "APPROVED_CROSSWALK", approvalSha256: HASH });
    } else {
      payload[column.column] = sampleValue(column);
      valueOrigins[column.column] = "SOURCE_EXACT";
      sourceBindings[column.column] = `/${column.column}`;
    }
  }
  return {
    projectionLocator: `projection-${targetTable}`,
    identityMode: generated === undefined ? "REUSED" : "GENERATED",
    targetTable,
    targetPkColumn,
    targetObjectType: generated?.objectType ?? "REUSED_PRIMARY_KEY",
    targetSourceNamespace: generated?.sourceNamespace ?? `object-import.reused.${targetTable}`,
    payload,
    valueOrigins,
    sourceBindings,
    referenceBindings,
    approvalKind: "SOURCE_DIRECT",
    approvalSha256: HASH
  };
}

function oneOutputManifest(output: CatalogProjectionOutputDirective): CatalogProjectionManifest {
  const copy = structuredClone(fixture);
  const domain = Object.entries(policy.domainTargets).find(([, tables]) => tables.includes(output.targetTable))?.[0];
  if (domain === undefined) throw new Error(`missing domain for ${output.targetTable}`);
  copy.sources = [{ ...copy.sources[0]!, recordDomain: domain.toUpperCase(), outputs: [output] }];
  return copy;
}

describe("data migration catalog projection Gate 1~3 contract", () => {
  it("uses concrete CUID2 PKs, matching FKs, audit columns and reverse-order rollback", () => {
    assert.equal(contract.migration, "458_data_migration_catalog_projection.sql");
    assert.deepEqual(contract.tables.map((table) => table.primaryKey), ["catalog_projection_run_id", "catalog_source_decision_id", "catalog_projection_record_id"]);
    for (const table of contract.tables) assert.deepEqual(table.auditColumns, ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);
    assert.doesNotMatch(migration, /^\s*id\s+/im);
    assert.doesNotMatch(migration, /\b(?:object_)?code\b/i);
    assert.equal((migration.match(/PRIMARY KEY \([a-z_]+_id\)/g) ?? []).length, 3);
    assert.equal((migration.match(/INSERT_USER VARCHAR\(100\)/g) ?? []).length, 3);
    assert.equal((migration.match(/INSERT_TIME CHAR\(19\)/g) ?? []).length, 3);
    assert.match(migration, /common_staging_run_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin/);
    assert.match(migration, /REFERENCES data_migration_common_staging_runs\(common_staging_run_id\)/);
    assert.match(migration, /RULE_PROVENANCE/);
    assert.match(rollback, /projection_records;[\s\S]*source_decisions;[\s\S]*projection_runs;/);
    assert.ok(contract.domainDecisions.furniture && contract.domainDecisions.miniPet && contract.domainDecisions.titles && contract.domainDecisions.equipment);
  });

  it("builds one complete PROJECT/QUARANTINE/IGNORE plan and preserves exact display text", () => {
    assert.equal(fixture.targetSchemaSha256, policy.targetSchemaSha256);
    const plan = buildCatalogProjectionPlan(fixture, policy);
    assert.match(plan.projectionManifestSha256, /^[0-9a-f]{64}$/);
    assert.equal(plan.projectionManifestSha256, "020374b85e8f93afbf1d383296ca461ba32eb45f27eeaa4b621c44f28e934a7a");
    assert.equal(plan.legacyProjectionManifestAliases.length, 2);
    assert.ok(plan.legacyProjectionManifestAliases.some((alias) => alias.projectionManifestSha256 === "84c4f86cef099e54c21844e98bc85e639e534d0468af59cb75c3cad6f6cc0762"));
    assert.match(plan.projectionSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(plan.decisions.map((decision) => decision.decisionStatus).sort(), ["IGNORE", "PROJECT", "QUARANTINE"]);
    const output = plan.decisions.find((decision) => decision.decisionStatus === "PROJECT")!.outputs[0]!;
    assert.equal(JSON.parse(output.targetPayloadJson).item_name, "다이아상자💎(/다이아상자오픈)");
    assert.equal(output.identityLocatorSha256, fixture.sources[0]!.sourceLocatorSha256);
    assert.equal(output.approvalKind, "CATALOG_PROVENANCE");
    assert.equal(output.approvalSha256, fixture.sources[0]!.outputs[0]!.approvalSha256);
    const reordered = structuredClone(fixture);
    reordered.sources.reverse();
    assert.equal(calculateCatalogProjectionManifestSha256(reordered, policy), plan.projectionManifestSha256);
    const envelopeChanged = structuredClone(fixture);
    envelopeChanged.commonStagingEnvelope.expectedTotalBytes = "2";
    assert.equal(calculateCatalogProjectionManifestSha256(envelopeChanged, policy), plan.projectionManifestSha256);
  });

  it("canonicalizes target schema across LF/CRLF and fails closed on malformed or semantic drift", () => {
    const document = JSON.parse(schemaBytes.toString("utf8")) as Record<string, unknown>;
    const lf = `${JSON.stringify(document, null, 2)}\n`;
    const crlf = lf.replace(/\n/g, "\r\n");
    assert.equal(calculateCatalogTargetSchemaSha256(lf), calculateCatalogTargetSchemaSha256(crlf));
    assert.deepEqual(calculateLegacyCatalogTargetSchemaSha256s(lf), calculateLegacyCatalogTargetSchemaSha256s(crlf));
    assert.throws(() => calculateCatalogTargetSchemaSha256("{"), /TARGET_SCHEMA_JSON_INVALID/);
    const drifted = structuredClone(document) as { columns: Array<Record<string, unknown>> };
    drifted.columns[0]!.nullable = !drifted.columns[0]!.nullable;
    assert.notEqual(calculateCatalogTargetSchemaSha256(JSON.stringify(drifted)), policy.targetSchemaSha256);
    const driftedManifest = structuredClone(fixture);
    driftedManifest.targetSchemaSha256 = calculateCatalogTargetSchemaSha256(JSON.stringify(drifted));
    assert.throws(() => buildCatalogProjectionPlan(driftedManifest, policy), /SCHEMA_HASH_MISMATCH/);
  });

  it("rejects guessed furniture, mini-pet, title, and equipment values", () => {
    const furniture = validOutput("object_furniture_definitions");
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(furniture), policy), /DOMAIN_ORIGIN_INVALID/);
    furniture.valueOrigins.purchase_price = "APPROVED_CATALOG";
    furniture.valueOrigins.charm_per_enhancement = "APPROVED_CATALOG";
    delete furniture.sourceBindings.purchase_price;
    delete furniture.sourceBindings.charm_per_enhancement;
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(furniture), policy), /CATALOG_APPROVAL_REQUIRED/);
    furniture.approvalKind = "CATALOG_PROVENANCE";
    assert.doesNotThrow(() => buildCatalogProjectionPlan(oneOutputManifest(furniture), policy));

    const miniOwned = validOutput("canonical_owned_mini_pet_instances");
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(miniOwned), policy), /OCCURRENCE_APPROVAL_REQUIRED/);
    miniOwned.approvalKind = "OCCURRENCE_CROSSWALK";
    miniOwned.approvalSha256 = HASH;
    miniOwned.sourceRole = "MINI_PET_BAG";
    miniOwned.payload.equipped_flag = false;
    miniOwned.payload.bound_flag = false;
    miniOwned.referenceBindings.find((binding) => binding.column === "mini_pet_id")!.bindingScope = "APPROVED_CROSSWALK";
    assert.doesNotThrow(() => buildCatalogProjectionPlan(oneOutputManifest(miniOwned), policy));
    assert.doesNotThrow(() => assertCatalogProjectionSourceRole("MINI_PET_BAG", miniOwned));
    assert.throws(() => assertCatalogProjectionSourceRole("MINI_PET_EQUIPPED", miniOwned), /MINI_PET_SOURCE_ROLE_MISMATCH/);
    miniOwned.payload.equipped_flag = true;
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(miniOwned), policy), /MINI_PET_BAG_STATE_INVALID/);
    miniOwned.sourceRole = "MINI_PET_EQUIPPED";
    miniOwned.payload.bound_flag = true;
    assert.doesNotThrow(() => buildCatalogProjectionPlan(oneOutputManifest(miniOwned), policy));
    assert.doesNotThrow(() => assertCatalogProjectionSourceRole("MINI_PET_EQUIPPED", miniOwned));
    miniOwned.payload.enhancement_level = "1";
    miniOwned.valueOrigins.enhancement_level = "CONSTANT_CONTRACT";
    delete miniOwned.sourceBindings.enhancement_level;
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(miniOwned), policy), /MINI_PET_DEFAULT_ENHANCEMENT_INVALID/);
    miniOwned.payload.enhancement_level = "0";
    assert.doesNotThrow(() => buildCatalogProjectionPlan(oneOutputManifest(miniOwned), policy));

    const title = validOutput("canonical_owned_member_title_instances");
    title.valueOrigins.acquisition_price = "APPROVED_CATALOG";
    delete title.sourceBindings.acquisition_price;
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(title), policy), /DOMAIN_ORIGIN_INVALID/);
    title.payload.acquisition_price = null;
    title.valueOrigins.acquisition_price = "SOURCE_ABSENT";
    title.sourceBindings.acquisition_price = "/acquisition_price";
    assert.doesNotThrow(() => buildCatalogProjectionPlan(oneOutputManifest(title), policy));

    const equipment = validOutput("canonical_owned_equipment_instances");
    equipment.payload.durability_amount = null;
    equipment.valueOrigins.durability_amount = "SOURCE_ABSENT";
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(equipment), policy), /DOMAIN_ORIGIN_INVALID/);
    equipment.payload.durability_amount = "0";
    equipment.valueOrigins.durability_amount = "EXPLICIT_RULE";
    delete equipment.sourceBindings.durability_amount;
    equipment.approvalKind = "RULE_PROVENANCE";
    assert.doesNotThrow(() => buildCatalogProjectionPlan(oneOutputManifest(equipment), policy));
  });

  it("requires target-schema column coverage and rejects identity or executable payloads", () => {
    const missing = structuredClone(fixture);
    delete missing.sources[0]!.outputs[0]!.payload.item_kind;
    delete missing.sources[0]!.outputs[0]!.valueOrigins.item_kind;
    assert.throws(() => buildCatalogProjectionPlan(missing, policy), /TARGET_COLUMN_COVERAGE_MISMATCH/);
    const forbidden = structuredClone(fixture);
    forbidden.sources[0]!.outputs[0]!.payload.code = "ITEM-DIAMOND-BOX";
    forbidden.sources[0]!.outputs[0]!.valueOrigins.code = "APPROVED_CATALOG";
    assert.throws(() => buildCatalogProjectionPlan(forbidden, policy), /FORBIDDEN_PAYLOAD_KEY/);
    const unsafe = structuredClone(fixture);
    unsafe.sources[0]!.outputs[0]!.payload.price_amount = 9007199254740992;
    unsafe.sources[0]!.outputs[0]!.valueOrigins.price_amount = "SOURCE_EXACT";
    assert.throws(() => buildCatalogProjectionPlan(unsafe, policy), /DECIMAL_INVALID|UNSAFE_NUMBER/);
    const integerOverflow = validOutput("canonical_owned_equipment_instances");
    integerOverflow.payload.enhancement_level = "999999999999999999999";
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(integerOverflow), policy), /INTEGER_RANGE_INVALID/);
    const decimalOverflow = structuredClone(fixture);
    decimalOverflow.sources[0]!.outputs[0]!.payload.price_amount = "123456789012345678901234567890123456789012345678901234567890123456";
    decimalOverflow.sources[0]!.outputs[0]!.valueOrigins.price_amount = "SOURCE_EXACT";
    assert.throws(() => buildCatalogProjectionPlan(decimalOverflow, policy), /DECIMAL_RANGE_INVALID/);
    const scaleOverflow = validOutput("canonical_mini_pet_enhancement_rules");
    for (const column of ["battle_charm_gain", "castle_charm_gain", "raid_charm_gain", "success_probability", "point_cost", "stone_quantity"]) {
      scaleOverflow.valueOrigins[column] = "APPROVED_CATALOG";
      delete scaleOverflow.sourceBindings[column];
    }
    scaleOverflow.approvalKind = "CATALOG_PROVENANCE";
    scaleOverflow.payload.success_probability = "0.12345678901";
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(scaleOverflow), policy), /DECIMAL_RANGE_INVALID/);
    const wrongReference = validOutput("canonical_owned_equipment_instances");
    wrongReference.valueOrigins.durability_amount = "EXPLICIT_RULE";
    delete wrongReference.sourceBindings.durability_amount;
    wrongReference.approvalKind = "RULE_PROVENANCE";
    const equipmentReference = wrongReference.referenceBindings.find((binding) => binding.column === "equipment_id")!;
    equipmentReference.targetTable = "canonical_players";
    equipmentReference.targetPkColumn = "player_id";
    assert.throws(() => buildCatalogProjectionPlan(oneOutputManifest(wrongReference), policy), /REFERENCE_TARGET_INVALID/);
    const extraReference = structuredClone(fixture);
    extraReference.sources[0]!.outputs[0]!.referenceBindings.push({ column: "ghost_id", targetTable: "canonical_players", targetPkColumn: "player_id", identityLocatorSha256: HASH, bindingScope: "APPROVED_CROSSWALK", approvalSha256: HASH });
    assert.throws(() => buildCatalogProjectionPlan(extraReference, policy), /EXTRA_REFERENCE_BINDING/);
    const crossDomain = structuredClone(fixture);
    crossDomain.sources[0]!.recordDomain = "FURNITURE";
    assert.throws(() => buildCatalogProjectionPlan(crossDomain, policy), /DOMAIN_TARGET_MISMATCH/);
    const arbitraryReason = structuredClone(fixture);
    arbitraryReason.sources[1]!.decisionReason = "ARBITRARY_REASON";
    assert.throws(() => buildCatalogProjectionPlan(arbitraryReason, policy), /QUARANTINE_REASON_NOT_ALLOWED/);
    const invalidPointer = structuredClone(fixture);
    invalidPointer.sources[0]!.outputs[0]!.sourceBindings.item_name = "/item~2name";
    assert.throws(() => buildCatalogProjectionPlan(invalidPointer, policy), /SOURCE_BINDING_POINTER_INVALID/);
  });

  it("refuses operational database names", () => {
    assert.doesNotThrow(() => assertCatalogProjectionDatabaseName("hoibot_schema_design"));
    assert.doesNotThrow(() => assertCatalogProjectionDatabaseName("hoibot_rehearsal_object_db"));
    assert.throws(() => assertCatalogProjectionDatabaseName("hoibot_prod"), /OPERATIONAL_DATABASE_REFUSED/);
  });
});

class ProjectionDatabase implements DatabaseClient {
  readonly writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  readonly decisionIds = new Map<string, string>();
  readonly outputRows: Array<{ decisionId: string; values: readonly unknown[] }> = [];
  constructor(private readonly plan = buildCatalogProjectionPlan(fixture, policy), private readonly replayRunId?: string, private readonly itemName = "다이아상자💎(/다이아상자오픈)", private readonly replayTargetSchemaSha256 = fixture.targetSchemaSha256, private readonly replayManifestSha256 = plan.projectionManifestSha256, private readonly replayRowCount = 1) {}
  async ping(): Promise<void> {}
  async verifyRollback(): Promise<boolean> { return true; }
  async close(): Promise<void> {}
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return work(this); }
  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    this.writes.push({ sql, values });
    if (sql.startsWith("INSERT INTO data_migration_catalog_source_decisions")) this.decisionIds.set(String(values[3]), String(values[0]));
    if (sql.startsWith("INSERT INTO data_migration_catalog_projection_records")) this.outputRows.push({ decisionId: String(values[2]), values });
    return { affectedRows: 1n, insertId: 0n };
  }
  async query<T>(sql: string): Promise<T> {
    if (sql.includes("FROM data_migration_common_staging_runs")) return [{ common_staging_run_id: fixture.commonStagingRunId, raw_bundle_sha256: fixture.commonStagingEnvelope.rawBundleSha256, snapshot_manifest_sha256: fixture.commonStagingEnvelope.snapshotManifestSha256, extraction_manifest_sha256: fixture.commonStagingEnvelope.extractionManifestSha256, staging_sha256: fixture.commonStagingSha256, expected_file_count: fixture.commonStagingEnvelope.expectedFileCount, expected_total_bytes: fixture.commonStagingEnvelope.expectedTotalBytes, expected_record_count: fixture.sources.length, projected_file_count: fixture.commonStagingEnvelope.projectedFileCount, ignored_file_count: fixture.commonStagingEnvelope.ignoredFileCount, run_status: "COMPLETE" }] as T;
    if (sql.includes("FROM data_migration_common_staging_records")) return fixture.sources.map((source, index) => ({ common_staging_record_id: `b123456${index}`, source_locator_sha256: source.sourceLocatorSha256, payload_json: source.decisionStatus === "PROJECT" ? JSON.stringify({ item_name: this.itemName }) : "{}", payload_fingerprint: source.sourcePayloadFingerprint, record_domain: source.recordDomain, record_kind: "SYNTHETIC", projection_status: source.decisionStatus === "QUARANTINE" ? "QUARANTINE" : "PROJECT", quarantine_reason: source.decisionStatus === "QUARANTINE" ? source.decisionReason : null })).sort((left, right) => left.source_locator_sha256.localeCompare(right.source_locator_sha256, "en")) as T;
    if (sql.includes("FROM data_migration_catalog_projection_runs")) {
      if (this.replayRunId === undefined) return [] as T;
      const counts = { projected: this.plan.decisions.filter((row) => row.decisionStatus === "PROJECT").length, quarantined: this.plan.decisions.filter((row) => row.decisionStatus === "QUARANTINE").length, ignored: this.plan.decisions.filter((row) => row.decisionStatus === "IGNORE").length, rows: this.plan.decisions.reduce((sum, row) => sum + row.outputs.length, 0) };
      return Array.from({ length: this.replayRowCount }, (_, index) => ({ catalog_projection_run_id: index === 0 ? this.replayRunId : "z7654321", projection_manifest_sha256: index === 0 ? this.replayManifestSha256 : this.plan.legacyProjectionManifestAliases.find((alias) => alias.projectionManifestSha256 !== this.replayManifestSha256)?.projectionManifestSha256, raw_bundle_sha256: fixture.commonStagingEnvelope.rawBundleSha256, snapshot_manifest_sha256: fixture.commonStagingEnvelope.snapshotManifestSha256, extraction_manifest_sha256: fixture.commonStagingEnvelope.extractionManifestSha256, expected_file_count: fixture.commonStagingEnvelope.expectedFileCount, expected_total_bytes: fixture.commonStagingEnvelope.expectedTotalBytes, projected_file_count: fixture.commonStagingEnvelope.projectedFileCount, ignored_file_count: fixture.commonStagingEnvelope.ignoredFileCount, upstream_envelope_sha256: upstreamEnvelopeSha256, target_schema_sha256: this.replayTargetSchemaSha256, projection_sha256: this.plan.projectionSha256, expected_source_count: this.plan.decisions.length, projected_source_count: counts.projected, quarantined_source_count: counts.quarantined, ignored_source_count: counts.ignored, projected_row_count: counts.rows, run_status: "COMPLETE" })) as T;
    }
    if (sql.includes("FROM data_migration_catalog_source_decisions")) return this.plan.decisions.map((decision, index) => ({ catalog_source_decision_id: this.decisionIds.get(decision.sourceLocatorSha256) ?? `c123456${index}`, common_staging_record_id: `b123456${fixture.sources.findIndex((source) => source.sourceLocatorSha256 === decision.sourceLocatorSha256)}`, source_locator_sha256: decision.sourceLocatorSha256, source_payload_fingerprint: decision.sourcePayloadFingerprint, record_domain: decision.recordDomain, decision_status: decision.decisionStatus, decision_reason: decision.decisionReason, projected_row_count: decision.outputs.length, decision_fingerprint: decision.decisionFingerprint })) as T;
    if (sql.includes("FROM data_migration_catalog_projection_records")) {
      const decisions = this.plan.decisions.map((decision, index) => ({ decision, decisionId: this.decisionIds.get(decision.sourceLocatorSha256) ?? `c123456${index}` }));
      return decisions.flatMap(({ decision, decisionId }) => decision.outputs.map((output) => ({ catalog_source_decision_id: decisionId, projection_locator: output.projectionLocator, identity_locator_sha256: output.identityLocatorSha256, identity_mode: output.identityMode, target_table_name: output.targetTable, target_pk_column_name: output.targetPkColumn, target_object_type: output.targetObjectType, target_source_namespace: output.targetSourceNamespace, source_role: output.sourceRole, approval_kind: output.approvalKind, approval_sha256: output.approvalSha256, target_payload_json: output.targetPayloadJson, target_payload_fingerprint: output.targetPayloadFingerprint, value_origins_json: output.valueOriginsJson, value_origins_fingerprint: output.valueOriginsFingerprint, reference_bindings_json: output.referenceBindingsJson, reference_bindings_fingerprint: output.referenceBindingsFingerprint }))).sort((left, right) => `${left.catalog_source_decision_id}\0${left.target_table_name}\0${left.projection_locator}`.localeCompare(`${right.catalog_source_decision_id}\0${right.target_table_name}\0${right.projection_locator}`, "en")) as T;
    }
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  }
}

describe("MariaCatalogProjectionRepository Gate 4", () => {
  it("commits one complete projection atomically and exact-replays with zero writes", async () => {
    const fresh = new ProjectionDatabase();
    const first = await new MariaCatalogProjectionRepository(fresh).project(fixture, policy);
    assert.equal(first.insertedDecisions, 3);
    assert.equal(first.insertedProjectionRecords, 1);
    assert.equal(first.replayed, false);
    assert.equal(fresh.writes.filter((write) => write.sql.startsWith("INSERT INTO data_migration_catalog_")).length, 5);
    assert.equal(fresh.writes.filter((write) => write.sql.startsWith("UPDATE data_migration_catalog_projection_runs")).length, 1);

    const replay = new ProjectionDatabase(undefined, first.catalogProjectionRunId);
    const replayed = await new MariaCatalogProjectionRepository(replay).project(fixture, policy);
    assert.deepEqual(replayed, { catalogProjectionRunId: first.catalogProjectionRunId, insertedDecisions: 0, insertedProjectionRecords: 0, replayed: true });
    assert.equal(replay.writes.length, 0);
  });

  it("zero-write replays both deterministic LF/CRLF migration-458 aliases and rejects ambiguity", async () => {
    const plan = buildCatalogProjectionPlan(fixture, policy);
    assert.equal(plan.legacyProjectionManifestAliases.length, 2);
    for (const alias of plan.legacyProjectionManifestAliases) {
      const database = new ProjectionDatabase(plan, "z1234567", "다이아상자💎(/다이아상자오픈)", alias.targetSchemaSha256, alias.projectionManifestSha256);
      const result = await new MariaCatalogProjectionRepository(database).project(fixture, policy);
      assert.equal(result.replayed, true);
      assert.equal(database.writes.length, 0);
    }
    const ambiguous = new ProjectionDatabase(plan, "z1234567", "다이아상자💎(/다이아상자오픈)", fixture.targetSchemaSha256, plan.projectionManifestSha256, 2);
    await assert.rejects(() => new MariaCatalogProjectionRepository(ambiguous).project(fixture, policy), /REPLAY_ALIAS_AMBIGUOUS/);
    assert.equal(ambiguous.writes.length, 0);
  });

  it("propagates Common Staging quarantine and fails before canonical projection writes", async () => {
    const changed = structuredClone(fixture);
    changed.sources.find((source) => source.decisionStatus === "QUARANTINE")!.decisionReason = "DEFINITION_REFERENCE_MISSING";
    const database = new ProjectionDatabase(buildCatalogProjectionPlan(changed, policy));
    await assert.rejects(() => new MariaCatalogProjectionRepository(database).project(changed, policy), /STAGING_QUARANTINE_MUST_PROPAGATE/);
    assert.equal(database.writes.length, 0);
  });

  it("fails before writes when SOURCE_EXACT does not match the Common Staging payload pointer", async () => {
    const database = new ProjectionDatabase(undefined, undefined, "변조된이름");
    await assert.rejects(() => new MariaCatalogProjectionRepository(database).project(fixture, policy), /SOURCE_EXACT_MISMATCH/);
    assert.equal(database.writes.length, 0);
  });

  it("does not resolve inherited object properties as RFC 6901 source values", async () => {
    const changed = structuredClone(fixture);
    changed.sources[0]!.outputs[0]!.payload.item_name = "Object";
    changed.sources[0]!.outputs[0]!.sourceBindings.item_name = "/constructor/name";
    const database = new ProjectionDatabase(buildCatalogProjectionPlan(changed, policy));
    await assert.rejects(() => new MariaCatalogProjectionRepository(database).project(changed, policy), /SOURCE_EXACT_MISMATCH/);
    assert.equal(database.writes.length, 0);
  });

  it("fails with zero writes when the locked Common Staging lineage envelope drifts", async () => {
    const changed = structuredClone(fixture);
    changed.commonStagingEnvelope.rawBundleSha256 = "f".repeat(64);
    const database = new ProjectionDatabase(buildCatalogProjectionPlan(changed, policy));
    await assert.rejects(() => new MariaCatalogProjectionRepository(database).project(changed, policy), /STAGING_ENVELOPE_MISMATCH/);
    assert.equal(database.writes.length, 0);
  });
});
