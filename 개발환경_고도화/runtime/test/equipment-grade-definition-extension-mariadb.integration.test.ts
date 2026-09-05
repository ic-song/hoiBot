import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createObjectAuditValues } from "../src/identity/object-identity-audit-provider.js";
import { calculateCatalogProjectionManifestSha256, calculateCatalogTargetSchemaSha256, MariaCatalogProjectionRepository, type CatalogProjectionPolicy } from "../src/data-migration/catalog-projection-provider.js";
import { buildEquipmentGradeProjectionManifest, calculateEquipmentGradeCommonStagingPayloadFingerprint, type EquipmentGradeSourceRecord } from "../src/data-migration/equipment-grade-definition-adapter.js";
import { applyEquipmentGradeImportExtension, parseEquipmentGradeImportExtension } from "../src/data-migration/equipment-grade-import-profile.js";
import { calculateObjectDomainImportComponentSemanticSha256, calculateObjectDomainImportContractSemanticSha256, MariaObjectDomainImporter, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256, type DomainImportPolicy } from "../src/data-migration/object-domain-importer.js";

const integration = process.env.RUN_EQUIPMENT_GRADE_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const contractRoot = new URL("../../migration-control/contracts/", import.meta.url);
const load = (name: string): string => readFileSync(new URL(name, contractRoot), "utf8");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const schema = JSON.parse(load("object-domain-import-target-schema.v1.json"));
const identity = JSON.parse(load("object-domain-import-identity-bindings.v1.json"));
const objectModel = JSON.parse(load("object-data-model-standard.v1.json"));
const disposition = JSON.parse(load("object-domain-import-disposition.v1.json"));
const fieldMap = JSON.parse(load("object-domain-import-field-map.v1.json"));
const importContractText = load("data-migration-object-domain-import.v1.json");
const extension = parseEquipmentGradeImportExtension({
  profile: load("object-domain-import-profile.equipment-grade-extension.v1.json"),
  schema: load("object-domain-import-target-schema.equipment-grade-extension.v1.json"),
  objectModel: load("object-data-model-equipment-grade-extension.v1.json"),
  fieldMap: load("object-domain-import-field-map.equipment-grade-extension.v1.json"),
  catalog: load("equipment-grade-catalog-projection.v1.json")
});
const baseDirectTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
const effective = applyEquipmentGradeImportExtension({
  columns: schema.columns,
  generatedBindings: identity.generatedCuidBindings,
  foreignKeys: objectModel.tables.flatMap((table: any) => (table.foreignKeys ?? []).filter((foreignKey: any) => "column" in foreignKey).map((foreignKey: any) => ({ table: table.table, ...foreignKey }))),
  definitionTargets: disposition.definitionSeed,
  directTargets: baseDirectTargets,
  domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping: any) => [mapping.domain, mapping.targetTables]))
}, extension);
const effectiveSchemaText = JSON.stringify({ catalogVersion: "SC-20260902-1", columns: effective.columns });
const targetSchemaSha256 = calculateCatalogTargetSchemaSha256(effectiveSchemaText);
const componentSemanticSha256 = Object.fromEntries(["identityBindings", "objectModel", "disposition", "fieldMap"].map((key) => [key, sha256(`equipment-grade-extension:${key}:${extension.semanticSha256}`)])) as DomainImportPolicy["componentSemanticSha256"];
const importContractSha256 = calculateObjectDomainImportContractSemanticSha256(importContractText);
const catalogPolicy: CatalogProjectionPolicy = {
  targetSchemaSha256, columns: effective.columns, generatedCuidBindings: effective.generatedBindings,
  reusedPrimaryKeys: identity.reusedPrimaryKeys, foreignKeys: effective.foreignKeys,
  domainTargets: effective.domainTargets, quarantineReasons: fieldMap.recordQuarantine
};
const importPolicy: DomainImportPolicy = {
  catalogVersion: "SC-20260902-1", targetSchemaSha256, importContractSha256,
  acceptedImportContractSha256: [importContractSha256, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256],
  componentSemanticSha256, contractComponentSemanticSha256: componentSemanticSha256,
  columns: effective.columns, generatedBindings: effective.generatedBindings, reusedBindings: identity.reusedPrimaryKeys,
  foreignKeys: effective.foreignKeys, directTargets: effective.directTargets, definitionTargets: effective.definitionTargets,
  domainTargets: effective.domainTargets, quarantineReasons: fieldMap.recordQuarantine,
  equipmentGradeExtension: { profile: "EQUIPMENT_GRADE_EXTENSION_V1", semanticSha256: extension.semanticSha256 }
};

function payload(index: number): string {
  const aliasCount = index < 18 ? 2 : 1;
  return JSON.stringify({
    nameList: Array.from({ length: aliasCount }, (_, aliasIndex) => `synthetic_alias_${index}_${aliasIndex}`), emoji: index < 61 ? "⚙️" : "💍",
    upgrade: index % 2 === 0 ? 0.125 : 1, drop: 0, itemCost: index + 1, pointCost: 250000 + index,
    maxLevel: 100, battleExp: 300 + index, battleUpgradeExp: 5, raidExp: 500 + index,
    raidUpgradeExp: 7, castleExp: 900 + index, castleUpgradeExp: 11
  });
}

integration("equipment grade definition extension actual Maria pipeline", () => {
  let database: DatabaseClient;
  const commonStagingRunId = "s2551000";
  const envelope = {
    commonStagingRunId, commonStagingSha256: sha256("lease2551-staging"), rawBundleSha256: sha256("lease2551-raw"),
    snapshotManifestSha256: sha256("lease2551-snapshot"), extractionManifestSha256: sha256("lease2551-extraction"),
    targetSchemaSha256, actor: "lease2551-integration", expectedFileCount: 1, expectedTotalBytes: "31289", projectedFileCount: 1, ignoredFileCount: 0
  };
  const records: EquipmentGradeSourceRecord[] = Array.from({ length: 106 }, (_, index) => {
    const family = index < 61 ? "elemental" : "ring";
    const sourcePointer = `/${family}/synthetic-${String(index).padStart(3, "0")}`;
    const payloadJson = payload(index);
    return { sourcePointer, sourceLocatorSha256: sha256(`data/itemInfo.json\0${sourcePointer}\0EQUIPMENT_GRADE_DEFINITION\0${sourcePointer}`), payloadFingerprint: calculateEquipmentGradeCommonStagingPayloadFingerprint(payloadJson), payloadJson, recordDomain: "pet-equipment", recordKind: "EQUIPMENT_GRADE_DEFINITION", projectionStatus: "PROJECT" };
  });
  const manifest = buildEquipmentGradeProjectionManifest(records, envelope);
  let catalogProjectionRunId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: process.env.DATABASE_HOST ?? "127.0.0.1", port: Number(process.env.DATABASE_PORT ?? "3308"), user: process.env.DATABASE_USER ?? "lease2551_test", password: process.env.DATABASE_PASSWORD ?? "lease2551_local", name: process.env.DATABASE_NAME ?? "hoibot_rehearsal_equipment_grade_2551", connectionLimit: 4, connectTimeoutMs: 5000 });
    const audit = createObjectAuditValues("lease2551-integration");
    await database.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,1,31289,106,1,0,'COMPLETE',?,?,?,?)", [commonStagingRunId, envelope.rawBundleSha256, envelope.snapshotManifestSha256, envelope.extractionManifestSha256, envelope.commonStagingSha256, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?, 'LEGACY_JSON','itemInfo.json',?,?, 'data/itemInfo.json',?,?,?,?,0,?,?,'EQUIPMENT_GRADE_DEFINITION','PROJECT',NULL,NULL,NULL,?,?,?, ?,?,?)", [`r${String(index).padStart(7, "0")}`, commonStagingRunId, sha256("data/itemInfo.json"), sha256("synthetic-itemInfo-content"), record.sourcePointer, record.sourcePointer, record.sourceLocatorSha256, null, record.sourcePointer, record.recordDomain, record.payloadJson, record.payloadFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    }
    const projected = await new MariaCatalogProjectionRepository(database).project(manifest, catalogPolicy);
    catalogProjectionRunId = projected.catalogProjectionRunId;
    assert.equal(projected.insertedDecisions, 106);
    assert.equal(projected.insertedProjectionRecords, 230);
  });

  after(async () => { await database.close(); });

  it("rolls back a broken graph, imports 106/124 with CUID2, exact-replays, detects drift, rolls back and restarts", async () => {
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-05T10:30:00.000Z"));
    await database.execute("CREATE TRIGGER lease2551_alias_failure BEFORE INSERT ON canonical_equipment_grade_aliases FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LEASE2551_FORCED_ALIAS_FAILURE'");
    await assert.rejects(() => importer.importProjection(catalogProjectionRunId, importPolicy, "lease2551-integration"), /LEASE2551_FORCED_ALIAS_FAILURE/);
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM canonical_equipment_grade_definitions) definitions,(SELECT COUNT(*) FROM canonical_equipment_grade_aliases) aliases"), [{ definitions: 0n, aliases: 0n }]);
    await database.execute("DROP TRIGGER lease2551_alias_failure");

    const first = await importer.importProjection(catalogProjectionRunId, importPolicy, "lease2551-integration");
    assert.equal(first.insertedCanonicalRows, 230);
    const aggregate = await database.query<Array<{ definitions: bigint; aliases: bigint; cuid_rows: bigint }>>("SELECT (SELECT COUNT(*) FROM canonical_equipment_grade_definitions) definitions,(SELECT COUNT(*) FROM canonical_equipment_grade_aliases) aliases,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_namespace IN ('object-import.pet-equipment.canonical_equipment_grade_definitions','object-import.pet-equipment.canonical_equipment_grade_aliases') AND CHAR_LENGTH(object_identity_id)=8) cuid_rows");
    assert.deepEqual(aggregate[0], { definitions: 106n, aliases: 124n, cuid_rows: 230n });
    const replay = await importer.importProjection(catalogProjectionRunId, importPolicy, "lease2551-replay");
    assert.equal(replay.insertedCanonicalRows, 0);
    assert.equal(replay.replayed, true);

    const staging = await database.query<Array<{ common_staging_record_id: string; payload_fingerprint: string }>>("SELECT common_staging_record_id,payload_fingerprint FROM data_migration_common_staging_records WHERE common_staging_run_id=? ORDER BY common_staging_record_id LIMIT 1", [commonStagingRunId]);
    await database.execute("UPDATE data_migration_common_staging_records SET payload_fingerprint=? WHERE common_staging_record_id=?", [sha256("source-drift"), staging[0]!.common_staging_record_id]);
    await assert.rejects(() => importer.importProjection(catalogProjectionRunId, importPolicy, "lease2551-source-drift"), /SOURCE|DECISION|PARITY|MISMATCH/);
    await database.execute("UPDATE data_migration_common_staging_records SET payload_fingerprint=? WHERE common_staging_record_id=?", [staging[0]!.payload_fingerprint, staging[0]!.common_staging_record_id]);

    const receipt = await database.query<Array<{ object_domain_import_record_id: string; binding_fingerprint: string }>>("SELECT object_domain_import_record_id,binding_fingerprint FROM data_migration_object_domain_import_records WHERE object_domain_import_run_id=? ORDER BY import_order LIMIT 1", [first.objectDomainImportRunId]);
    await database.execute("UPDATE data_migration_object_domain_import_records SET binding_fingerprint=? WHERE object_domain_import_record_id=?", [sha256("receipt-drift"), receipt[0]!.object_domain_import_record_id]);
    await assert.rejects(() => importer.importProjection(catalogProjectionRunId, importPolicy, "lease2551-receipt-drift"), /RECEIPT|PARITY|MISMATCH/);
    await database.execute("UPDATE data_migration_object_domain_import_records SET binding_fingerprint=? WHERE object_domain_import_record_id=?", [receipt[0]!.binding_fingerprint, receipt[0]!.object_domain_import_record_id]);

    assert.equal(await importer.rollback(catalogProjectionRunId, importPolicy), 1);
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM canonical_equipment_grade_definitions) definitions,(SELECT COUNT(*) FROM canonical_equipment_grade_aliases) aliases"), [{ definitions: 0n, aliases: 0n }]);
    const restarted = await importer.importProjection(catalogProjectionRunId, importPolicy, "lease2551-restart");
    assert.equal(restarted.insertedCanonicalRows, 230);
    assert.equal(await importer.rollback(catalogProjectionRunId, importPolicy), 1);
    assert.equal(await new MariaCatalogProjectionRepository(database).rollback(commonStagingRunId, "SC-20260902-1", calculateCatalogProjectionManifestSha256(manifest, catalogPolicy)), 1);
    await database.execute("DELETE FROM data_migration_common_staging_runs WHERE common_staging_run_id=?", [commonStagingRunId]);
  });
});
