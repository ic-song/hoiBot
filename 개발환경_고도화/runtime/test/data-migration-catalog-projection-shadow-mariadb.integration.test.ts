import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../src/identity/object-identity-audit-provider.js";
import {
  assertCatalogProjectionDatabaseName,
  buildCatalogProjectionPlan,
  calculateCatalogProjectionManifestSha256,
  calculateCatalogTargetSchemaSha256,
  calculateLegacyCatalogTargetSchemaSha256s,
  MariaCatalogProjectionRepository,
  type CatalogForeignKeyBinding,
  type CatalogProjectionManifest,
  type CatalogProjectionPolicy,
  type CatalogTargetSchemaColumn
} from "../src/data-migration/catalog-projection-provider.js";
import {
  calculateObjectDomainImportSemanticSha256,
  MariaObjectDomainImporter,
  stableDomainImportJson,
  type DomainImportPolicy
} from "../src/data-migration/object-domain-importer.js";

const shadow = process.env.CATALOG_PROJECTION_GATE7_PHASE === undefined ? describe.skip : describe;
const contractRoot = new URL("../../migration-control/contracts/", import.meta.url);
const fixtureRoot = new URL("../../migration-control/fixtures/synthetic-relational/", import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, contractRoot), "utf8");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const schemaText = read("object-domain-import-target-schema.v1.json");
const schema = JSON.parse(schemaText) as { columns: CatalogTargetSchemaColumn[] };
const identityText = read("object-domain-import-identity-bindings.v1.json");
const identity = JSON.parse(identityText) as { generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] };
const objectModelText = read("object-data-model-standard.v1.json");
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<Omit<CatalogForeignKeyBinding, "table">> }> };
const dispositionText = read("object-domain-import-disposition.v1.json");
const disposition = JSON.parse(dispositionText) as { definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[] };
const fieldMapText = read("object-domain-import-field-map.v1.json");
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const importContractText = read("data-migration-object-domain-import.v1.json");
const importContract = JSON.parse(importContractText) as { componentSemanticSha256: DomainImportPolicy["contractComponentSemanticSha256"] };
const base = JSON.parse(readFileSync(new URL("data-migration-catalog-projection-v1.json", fixtureRoot), "utf8")) as CatalogProjectionManifest;
const foreignKeys = objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey })));
const domainTargets = Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables]));
const targetSchemaSha256 = calculateCatalogTargetSchemaSha256(schemaText);
const catalogPolicy: CatalogProjectionPolicy = {
  targetSchemaSha256,
  legacyTargetSchemaSha256s: calculateLegacyCatalogTargetSchemaSha256s(schemaText),
  columns: schema.columns,
  generatedCuidBindings: identity.generatedCuidBindings,
  reusedPrimaryKeys: identity.reusedPrimaryKeys,
  foreignKeys,
  domainTargets,
  quarantineReasons: fieldMap.recordQuarantine
};
const componentSemanticSha256 = {
  identityBindings: calculateObjectDomainImportSemanticSha256(identityText),
  objectModel: calculateObjectDomainImportSemanticSha256(objectModelText),
  disposition: calculateObjectDomainImportSemanticSha256(dispositionText),
  fieldMap: calculateObjectDomainImportSemanticSha256(fieldMapText)
};
const importPolicy: DomainImportPolicy = {
  catalogVersion: "SC-20260902-1",
  targetSchemaSha256,
  importContractSha256: calculateObjectDomainImportSemanticSha256(importContractText),
  componentSemanticSha256,
  contractComponentSemanticSha256: importContract.componentSemanticSha256,
  columns: schema.columns,
  generatedBindings: identity.generatedCuidBindings,
  reusedBindings: identity.reusedPrimaryKeys,
  foreignKeys,
  directTargets: [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly],
  definitionTargets: disposition.definitionSeed,
  domainTargets,
  quarantineReasons: fieldMap.recordQuarantine
};
const commonStagingRunId = "s725g701";
const manifest: CatalogProjectionManifest = { ...base, commonStagingRunId };
const expectedPlan = buildCatalogProjectionPlan(manifest, catalogPolicy);
const expectedEnvelopeSha256 = sha256(stableDomainImportJson({
  expectedFileCount: manifest.commonStagingEnvelope.expectedFileCount,
  expectedTotalBytes: manifest.commonStagingEnvelope.expectedTotalBytes,
  extractionManifestSha256: manifest.commonStagingEnvelope.extractionManifestSha256,
  ignoredFileCount: manifest.commonStagingEnvelope.ignoredFileCount,
  projectedFileCount: manifest.commonStagingEnvelope.projectedFileCount,
  rawBundleSha256: manifest.commonStagingEnvelope.rawBundleSha256,
  snapshotManifestSha256: manifest.commonStagingEnvelope.snapshotManifestSha256,
  stagingSha256: manifest.commonStagingSha256
}));
const frozen = {
  manifestSha256: "5f2616873708435b5c1aa3d4dda0c04e80b249294341a9c8d04a7c1f12b55315",
  projectionSha256: "d430c38cff06cb1711d080e6b360d9ffcbc95e11006cebe91c0ea157ddc25432",
  decisionFingerprints: [
    "6b38c239125ee344d296f159657f6bec54e8798995240dd3cb68acb5628032d1",
    "bfa6f541e2912c6a2530af72fbd8f7d91acd34d8560969bef4bcbf6659a15259",
    "f21da1ae5ec0fd8f98f922d2cc620c0797a7ec0b9902158fff3ea61501f76331"
  ],
  targetPayloadFingerprint: "391c84b3fcf454d7efe396d99b62ffbf3545608c12c391edfaca7e4f2e9eac9d",
  valueOriginsFingerprint: "220c3d139a976ca88d004e81b3d95eca57533e431ddddb45b468904097a54f1e",
  referenceBindingsFingerprint: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
};

type ProjectionSnapshot = {
  run: Record<string, unknown>;
  decisions: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
};

const normalize = (value: unknown): unknown => typeof value === "bigint" ? value.toString() : value;
const normalizedRows = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalize(value)])));

async function projectionSnapshot(database: DatabaseClient): Promise<ProjectionSnapshot> {
  const runs = await database.query<Array<Record<string, unknown>>>("SELECT common_staging_run_id,catalog_version,projection_manifest_sha256,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,expected_total_bytes,projected_file_count,ignored_file_count,target_schema_sha256,projection_sha256,upstream_envelope_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status FROM data_migration_catalog_projection_runs WHERE common_staging_run_id=?", [commonStagingRunId]);
  const decisions = await database.query<Array<Record<string, unknown>>>("SELECT decision.source_locator_sha256,decision.source_payload_fingerprint,decision.record_domain,decision.decision_status,decision.decision_reason,decision.projected_row_count,decision.decision_fingerprint FROM data_migration_catalog_source_decisions decision JOIN data_migration_catalog_projection_runs run ON run.catalog_projection_run_id=decision.catalog_projection_run_id WHERE run.common_staging_run_id=? ORDER BY decision.source_locator_sha256", [commonStagingRunId]);
  const records = await database.query<Array<Record<string, unknown>>>("SELECT projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,target_payload_json,target_payload_fingerprint,value_origins_json,value_origins_fingerprint,reference_bindings_json,reference_bindings_fingerprint FROM data_migration_catalog_projection_records record JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=record.catalog_source_decision_id JOIN data_migration_catalog_projection_runs run ON run.catalog_projection_run_id=decision.catalog_projection_run_id WHERE run.common_staging_run_id=? ORDER BY target_table_name,projection_locator", [commonStagingRunId]);
  assert.equal(runs.length, 1);
  return { run: normalizedRows(runs)[0]!, decisions: normalizedRows(decisions), records: normalizedRows(records) };
}

function assertIndependentExpected(snapshot: ProjectionSnapshot): void {
  assert.equal(expectedPlan.projectionManifestSha256, frozen.manifestSha256);
  assert.equal(expectedPlan.projectionSha256, frozen.projectionSha256);
  assert.deepEqual(componentSemanticSha256, importContract.componentSemanticSha256);
  assert.deepEqual(snapshot.run, {
    common_staging_run_id: commonStagingRunId, catalog_version: manifest.catalogVersion,
    projection_manifest_sha256: frozen.manifestSha256,
    raw_bundle_sha256: manifest.commonStagingEnvelope.rawBundleSha256,
    snapshot_manifest_sha256: manifest.commonStagingEnvelope.snapshotManifestSha256,
    extraction_manifest_sha256: manifest.commonStagingEnvelope.extractionManifestSha256,
    expected_file_count: 1, expected_total_bytes: "1", projected_file_count: 1, ignored_file_count: 0,
    target_schema_sha256: targetSchemaSha256, projection_sha256: frozen.projectionSha256,
    upstream_envelope_sha256: expectedEnvelopeSha256, expected_source_count: 3, projected_source_count: 1,
    quarantined_source_count: 1, ignored_source_count: 1, projected_row_count: 1, run_status: "COMPLETE"
  });
  const expectedSources = [...manifest.sources].sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"));
  assert.deepEqual(snapshot.decisions, expectedSources.map((source, index) => ({
    source_locator_sha256: source.sourceLocatorSha256,
    source_payload_fingerprint: source.sourcePayloadFingerprint,
    record_domain: source.recordDomain,
    decision_status: source.decisionStatus,
    decision_reason: source.decisionReason ?? null,
    projected_row_count: source.outputs.length,
    decision_fingerprint: frozen.decisionFingerprints[index]
  })));
  assert.equal(snapshot.records.length, 1);
  assert.deepEqual({ ...snapshot.records[0], target_payload_json: undefined, value_origins_json: undefined, reference_bindings_json: undefined }, {
    projection_locator: "item-definition-0",
    identity_locator_sha256: manifest.sources[0]!.sourceLocatorSha256,
    identity_mode: "GENERATED",
    target_table_name: "canonical_item_definitions",
    target_pk_column_name: "item_id",
    target_object_type: "CANONICAL_ITEM_DEFINITIONS",
    target_source_namespace: "object-import.item.canonical_item_definitions",
    source_role: null,
    approval_kind: "CATALOG_PROVENANCE",
    approval_sha256: "9197392772536e3bf093278a228f93ee0c94e043af1330b5743c4969b90a3182",
    target_payload_json: undefined,
    target_payload_fingerprint: frozen.targetPayloadFingerprint,
    value_origins_json: undefined,
    value_origins_fingerprint: frozen.valueOriginsFingerprint,
    reference_bindings_json: undefined,
    reference_bindings_fingerprint: frozen.referenceBindingsFingerprint
  });
  const jsonValue = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : value;
  const targetPayload = jsonValue(snapshot.records[0]!.target_payload_json);
  assert.equal((targetPayload as Record<string, unknown>).item_name, "다이아상자💎(/다이아상자오픈)");
  assert.equal(stableDomainImportJson(targetPayload), expectedPlan.decisions[0]!.outputs[0]!.targetPayloadJson);
  assert.equal(stableDomainImportJson(jsonValue(snapshot.records[0]!.value_origins_json)), expectedPlan.decisions[0]!.outputs[0]!.valueOriginsJson);
  assert.equal(stableDomainImportJson(jsonValue(snapshot.records[0]!.reference_bindings_json)), expectedPlan.decisions[0]!.outputs[0]!.referenceBindingsJson);
}

async function statusCounters(database: DatabaseClient): Promise<Record<string, bigint>> {
  const rows = await database.query<Array<{ Variable_name: string; Value: string }>>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Com_insert','Com_update','Com_delete','Com_replace')");
  return Object.fromEntries(rows.map((row) => [row.Variable_name, BigInt(row.Value)]));
}

shadow("WBS725 Gate 7 isolated projection Shadow", () => {
  let database: DatabaseClient;

  before(async () => {
    const config = loadConfig();
    assertCatalogProjectionDatabaseName(config.database.name);
    const combinedGate7 = process.env.WBS742_GATE7_COMBINED === "true";
    assert.deepEqual(
      [config.database.host, config.database.port, config.database.name],
      combinedGate7
        ? ["127.0.0.1", 3323, "hoibot_rehearsal_wbs742_gate7"]
        : ["127.0.0.1", 3322, "hoibot_rehearsal_wbs725_gate7"]
    );
    database = createDatabaseClient(config.database);
    if (process.env.CATALOG_PROJECTION_GATE7_PHASE === "prepare") {
      const audit = createObjectAuditValues("wbs725-gate7-shadow");
      await database.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?)", [commonStagingRunId, manifest.commonStagingEnvelope.rawBundleSha256, manifest.commonStagingEnvelope.snapshotManifestSha256, manifest.commonStagingEnvelope.extractionManifestSha256, manifest.commonStagingSha256, 1, 1, 3, 1, 0, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      for (const source of manifest.sources) await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [createObjectIdentityCandidate(), commonStagingRunId, "LEGACY_JSON", "wbs725-gate7", "4".repeat(64), "5".repeat(64), "synthetic.json", "", "", source.sourceLocatorSha256, null, 0, null, source.recordDomain, "SYNTHETIC", source.decisionStatus === "QUARANTINE" ? "QUARANTINE" : "PROJECT", source.decisionStatus === "QUARANTINE" ? source.decisionReason : null, null, null, source.decisionStatus === "PROJECT" ? JSON.stringify({ item_name: "다이아상자💎(/다이아상자오픈)" }) : "{}", source.sourcePayloadFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    }
  });

  after(async () => { await database.close(); });

  it(`preserves the independent projection oracle through ${process.env.CATALOG_PROJECTION_GATE7_PHASE}`, async () => {
    const phase = process.env.CATALOG_PROJECTION_GATE7_PHASE;
    assert.ok(phase === "prepare" || phase === "replay-rollback");
    const migrations = await database.query<Array<{ total: bigint; provider_count: bigint }>>("SELECT COUNT(*) total,SUM(version IN ('457_data_migration_common_staging.sql','458_data_migration_catalog_projection.sql','459_catalog_projection_upstream_envelope.sql','460_data_migration_object_domain_import.sql')) provider_count FROM schema_migrations");
    assert.deepEqual([Number(migrations[0]!.total), Number(migrations[0]!.provider_count)], [448, 4]);
    const projection = new MariaCatalogProjectionRepository(database);
    const importer = new MariaObjectDomainImporter(database);
    const beforeCounters = await statusCounters(database);
    const projected = await projection.project(manifest, catalogPolicy);
    const beforeImport = await projectionSnapshot(database);
    assertIndependentExpected(beforeImport);
    const imported = await importer.importProjection(projected.catalogProjectionRunId, importPolicy, "wbs725-gate7-shadow");
    const afterImport = await projectionSnapshot(database);
    assert.deepEqual(afterImport, beforeImport);
    assertIndependentExpected(afterImport);
    if (phase === "prepare") {
      assert.deepEqual([projected.insertedDecisions, projected.insertedProjectionRecords, projected.replayed], [3, 1, false]);
      assert.deepEqual([imported.insertedCanonicalRows, imported.insertedDecisionReceipts, imported.replayed], [1, 3, false]);
      return;
    }
    assert.deepEqual([projected.insertedDecisions, projected.insertedProjectionRecords, projected.replayed], [0, 0, true]);
    assert.deepEqual([imported.insertedCanonicalRows, imported.insertedDecisionReceipts, imported.replayed], [0, 0, true]);
    const afterCounters = await statusCounters(database);
    for (const name of Object.keys(beforeCounters)) assert.equal(afterCounters[name], beforeCounters[name], `${name} changed during replay`);
    assert.equal(await importer.rollback(projected.catalogProjectionRunId, importPolicy), 1);
    assert.equal(await projection.rollback(commonStagingRunId, manifest.catalogVersion, calculateCatalogProjectionManifestSha256(manifest, catalogPolicy)), 1);
    await database.execute("DELETE FROM data_migration_common_staging_runs WHERE common_staging_run_id=?", [commonStagingRunId]);
    assert.equal((await database.query<Array<{ row_count: bigint }>>("SELECT COUNT(*) row_count FROM data_migration_catalog_projection_runs WHERE common_staging_run_id=?", [commonStagingRunId]))[0]!.row_count, 0n);
  });
});
