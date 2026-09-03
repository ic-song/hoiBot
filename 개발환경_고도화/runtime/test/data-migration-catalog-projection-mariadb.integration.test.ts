import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../src/identity/object-identity-audit-provider.js";
import { assertCatalogProjectionDatabaseName, calculateCatalogProjectionManifestSha256, calculateCatalogTargetSchemaSha256, calculateLegacyCatalogTargetSchemaSha256s, MariaCatalogProjectionRepository, type CatalogForeignKeyBinding, type CatalogGeneratedIdentityBinding, type CatalogProjectionManifest, type CatalogProjectionPolicy, type CatalogReusedIdentityBinding, type CatalogTargetSchemaColumn } from "../src/data-migration/catalog-projection-provider.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const schemaBytes = readFileSync(new URL("../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url));
const schema = JSON.parse(schemaBytes.toString("utf8")) as { columns: CatalogTargetSchemaColumn[] };
const bindings = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-identity-bindings.v1.json", import.meta.url), "utf8")) as { generatedCuidBindings: CatalogGeneratedIdentityBinding[]; reusedPrimaryKeys: CatalogReusedIdentityBinding[] };
const objectModel = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const fieldMap = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-field-map.v1.json", import.meta.url), "utf8")) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const base = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/data-migration-catalog-projection-v1.json", import.meta.url), "utf8")) as CatalogProjectionManifest;
const policy: CatalogProjectionPolicy = { targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaBytes.toString("utf8")), legacyTargetSchemaSha256s: calculateLegacyCatalogTargetSchemaSha256s(schemaBytes.toString("utf8")), columns: schema.columns, generatedCuidBindings: bindings.generatedCuidBindings, reusedPrimaryKeys: bindings.reusedPrimaryKeys, foreignKeys: objectModel.tables.flatMap((table): CatalogForeignKeyBinding[] => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))), domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])), quarantineReasons: fieldMap.recordQuarantine };

integration("data migration catalog projection MariaDB", () => {
  let database: DatabaseClient;
  const commonStagingRunId = createObjectIdentityCandidate();
  const manifest: CatalogProjectionManifest = { ...base, commonStagingRunId };

  before(async () => {
    const config = loadConfig();
    assertCatalogProjectionDatabaseName(config.database.name);
    database = createDatabaseClient(config.database);
    const audit = createObjectAuditValues("catalog-projection-integration");
    await database.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?)", [commonStagingRunId, "1".repeat(64), "2".repeat(64), "3".repeat(64), manifest.commonStagingSha256, 1, 1, manifest.sources.length, 1, 0, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    for (const source of manifest.sources) await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [createObjectIdentityCandidate(), commonStagingRunId, "LEGACY_JSON", "synthetic", "4".repeat(64), "5".repeat(64), "synthetic.json", "", "", source.sourceLocatorSha256, null, 0, null, source.recordDomain, "SYNTHETIC", source.decisionStatus === "QUARANTINE" ? "QUARANTINE" : "PROJECT", source.decisionStatus === "QUARANTINE" ? source.decisionReason : null, null, null, source.decisionStatus === "PROJECT" ? JSON.stringify({ item_name: "다이아상자💎(/다이아상자오픈)" }) : "{}", source.sourcePayloadFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  });

  after(async () => {
    await new MariaCatalogProjectionRepository(database).rollback(commonStagingRunId, manifest.catalogVersion, calculateCatalogProjectionManifestSha256(manifest, policy));
    await database.execute("DELETE FROM data_migration_common_staging_runs WHERE common_staging_run_id=?", [commonStagingRunId]);
    await database.close();
  });

  it("projects, exact-replays, and cascades rollback only inside the isolated DB", async () => {
    const repository = new MariaCatalogProjectionRepository(database);
    const first = await repository.project(manifest, policy);
    const replay = await repository.project({ ...manifest, actor: "catalog-projection-replay" }, policy);
    assert.equal(first.insertedDecisions, manifest.sources.length);
    assert.equal(first.insertedProjectionRecords, 1);
    assert.deepEqual(replay, { catalogProjectionRunId: first.catalogProjectionRunId, insertedDecisions: 0, insertedProjectionRecords: 0, replayed: true });
    const row = (await database.query<Array<{ decisions: bigint; projections: bigint }>>("SELECT (SELECT COUNT(*) FROM data_migration_catalog_source_decisions WHERE catalog_projection_run_id=?) decisions,(SELECT COUNT(*) FROM data_migration_catalog_projection_records record JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=record.catalog_source_decision_id WHERE decision.catalog_projection_run_id=?) projections", [first.catalogProjectionRunId, first.catalogProjectionRunId]))[0]!;
    assert.equal(Number(row.decisions), manifest.sources.length);
    assert.equal(Number(row.projections), 1);
    assert.equal(await repository.rollback(commonStagingRunId, manifest.catalogVersion, calculateCatalogProjectionManifestSha256(manifest, policy)), 1);
  });
});
