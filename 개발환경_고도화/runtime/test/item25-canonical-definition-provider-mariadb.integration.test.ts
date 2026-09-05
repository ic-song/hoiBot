import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import type { CommonStagingRecord } from "../src/data-migration/common-staging-extractor.js";
import {
  buildItem25CanonicalDefinitionManifest,
  ITEM25_IDENTITY_SOURCE_NAMESPACE,
  ITEM25_IMPORT_SOURCE_NAMESPACE,
  MariaItem25CanonicalDefinitionProvider,
  type Item25CanonicalDefinitionManifest
} from "../src/data-migration/item25-canonical-definition-provider.js";
import { createObjectAuditValues } from "../src/identity/object-identity-audit-provider.js";
import { calculateObjectDomainParityImportSha256 } from "../src/data-migration/object-domain-parity-verifier.js";
import { CanonicalItemInventoryRepository } from "../src/inventory/canonical-item-inventory-repository.js";

const integration = process.env.RUN_ITEM25_CANONICAL_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const approvalByKind = { RAID_SPECIAL: "d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259", TERRITORY_TICKET: "b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a", CASTLE_UNIT: "329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3" } as const;
function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}
function stringNumbers(value: unknown): unknown { if (typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(stringNumbers); if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, stringNumbers(child)])); return value; }

function records(): CommonStagingRecord[] {
  const definitions = [
    ...Array.from({ length: 9 }, (_, index) => ({ sourcePointer: `/raidSpecialItem/dept${index < 8 ? "1" : "2"}/item_${index < 8 ? index : 0}`, recordKind: "RAID_ITEM_DEFINITION" })),
    ...Array.from({ length: 6 }, (_, index) => ({ sourcePointer: `/castlePremiumItem/${index < 3 ? "offense" : "defense"}/item_${index % 3}`, recordKind: "TERRITORY_ITEM_DEFINITION" })),
    ...Array.from({ length: 10 }, (_, index) => ({ sourcePointer: `/castleItem/item_${index}`, recordKind: "CASTLE_ITEM_DEFINITION" }))
  ];
  const source = JSON.parse(readFileSync(new URL("../../../data/itemInfo.json", import.meta.url), "utf8")) as Record<string, unknown>;
  return definitions.map((definition, occurrenceIndex) => {
    const payload = definition.sourcePointer.split("/").slice(1).reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], source);
    const payloadJson = JSON.stringify(payload);
    return {
      sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo.json", sourcePathSha256: sha256("data/itemInfo.json"),
      sourceContentSha256: "49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc", logicalSourceName: "data/itemInfo.json",
      sourcePointer: definition.sourcePointer, identityPointer: definition.sourcePointer,
      sourceLocatorSha256: sha256(`data/itemInfo.json\0${definition.sourcePointer}\0${definition.recordKind}\0${definition.sourcePointer}`),
      ownerLocatorSha256: null, occurrenceIndex, projectionLocator: definition.sourcePointer, recordDomain: "ITEM", recordKind: definition.recordKind,
      projectionStatus: "PROJECT", quarantineReason: null, quantityValue: null, observedTime: null, payloadJson,
      payloadFingerprint: sha256(stable(JSON.parse(payloadJson)))
    };
  });
}

integration("item25 canonical definition provider actual Maria transaction", () => {
  let database: DatabaseClient;
  const databaseConfig = {
    enabled: true, host: process.env.DATABASE_HOST ?? "127.0.0.1", port: Number(process.env.DATABASE_PORT ?? "3308"),
    user: process.env.DATABASE_USER ?? "lease2556_test", password: process.env.DATABASE_PASSWORD ?? "lease2556_local",
    name: process.env.DATABASE_NAME ?? "hoibot_rehearsal_item25_2556", connectionLimit: 1, connectTimeoutMs: 5000
  } as const;
  let manifest: Item25CanonicalDefinitionManifest;
  const source = records();
  const audit = createObjectAuditValues("lease2556-integration", new Date("2026-09-05T10:30:00.000Z"));
  const commonRunId = "s2556000";
  const catalogRunId = "c2556000";
  const domainRunId = "d2556000";

  before(async () => {
    database = createDatabaseClient(databaseConfig);
    manifest = buildItem25CanonicalDefinitionManifest(source);
    const prepared = manifest.entries.map((entry, index) => {
      const sourceRecord = source.find((candidate) => candidate.sourcePointer === entry.sourcePointer)!;
      const itemId = `i${String(index + 1).padStart(7, "0")}`, decisionId = `q${String(index + 1).padStart(7, "0")}`, projectionId = `p${String(index + 1).padStart(7, "0")}`;
      const options = stringNumbers(JSON.parse(sourceRecord.payloadJson)) as Record<string, unknown>;
      const payload = { active_flag: true, definition_options: options, item_description: null, item_grade: null, item_kind: entry.itemKind, item_name: options.name, price_amount: null, price_currency_source_identifier: null, stackable_flag: true };
      const origins = { active_flag: "APPROVED_CATALOG", definition_options: "SOURCE_EXACT", item_description: "SOURCE_ABSENT", item_grade: "SOURCE_ABSENT", item_kind: "APPROVED_CATALOG", item_name: "SOURCE_EXACT", price_amount: "SOURCE_ABSENT", price_currency_source_identifier: "SOURCE_ABSENT", stackable_flag: "APPROVED_CATALOG" };
      const targetPayloadJson = stable(payload), originsJson = stable(origins), referencesJson = "[]", approval = approvalByKind[entry.itemKind];
      const projection = { catalog_projection_record_id: projectionId, catalog_source_decision_id: decisionId, projection_locator: entry.sourcePointer, identity_locator_sha256: entry.sourceLocatorSha256, identity_mode: "GENERATED", target_table_name: "canonical_item_definitions", target_pk_column_name: "item_id", target_object_type: "CANONICAL_ITEM_DEFINITIONS", target_source_namespace: ITEM25_IDENTITY_SOURCE_NAMESPACE, source_role: null, approval_kind: "CATALOG_PROVENANCE", approval_sha256: approval, target_payload_json: targetPayloadJson, target_payload_fingerprint: sha256(targetPayloadJson), value_origins_json: originsJson, value_origins_fingerprint: sha256(originsJson), reference_bindings_json: referencesJson, reference_bindings_fingerprint: sha256(referencesJson) };
      const outputs = [{ projectionLocator: projection.projection_locator, identityLocatorSha256: projection.identity_locator_sha256, identityMode: projection.identity_mode, targetTable: projection.target_table_name, targetPkColumn: projection.target_pk_column_name, targetObjectType: projection.target_object_type, targetSourceNamespace: projection.target_source_namespace, sourceRole: projection.source_role, approvalKind: projection.approval_kind, approvalSha256: projection.approval_sha256, targetPayloadJson: projection.target_payload_json, targetPayloadFingerprint: projection.target_payload_fingerprint, valueOriginsJson: projection.value_origins_json, valueOriginsFingerprint: projection.value_origins_fingerprint, referenceBindingsJson: projection.reference_bindings_json, referenceBindingsFingerprint: projection.reference_bindings_fingerprint }];
      const decisionBody = { sourceLocatorSha256: entry.sourceLocatorSha256, sourcePayloadFingerprint: entry.sourcePayloadFingerprint, recordDomain: "ITEM", decisionStatus: "PROJECT", decisionReason: null, outputs };
      const decisionFingerprint = sha256(stable(decisionBody));
      const binding = sha256(stable({ targetTable: "canonical_item_definitions", targetPkColumn: "item_id", targetObjectType: "CANONICAL_ITEM_DEFINITIONS", targetSourceNamespace: ITEM25_IDENTITY_SOURCE_NAMESPACE, identityLocatorSha256: entry.sourceLocatorSha256, targetPayloadFingerprint: projection.target_payload_fingerprint, valueOriginsFingerprint: projection.value_origins_fingerprint, referenceBindingsFingerprint: projection.reference_bindings_fingerprint, approvalKind: projection.approval_kind, approvalSha256: approval }));
      return { entry, sourceRecord, itemId, decisionId, projectionId, receiptId: `r${String(index + 1).padStart(7, "0")}`, options, payload, origins, projection, decisionBody, decisionFingerprint, binding, importedRow: sha256(stable({ table: "canonical_item_definitions", pkColumn: "item_id", pk: itemId, payload, references: {} })) };
    });
    const envelope = {
      raw: sha256("lease2556-raw"), snapshot: sha256("lease2556-snapshot"), extraction: sha256("lease2556-extraction"),
      staging: sha256("lease2556-staging"), projectionManifest: sha256("lease2556-projection-manifest"),
      schema: "2d0229891ffaaf486ec9fe7f786d362b90d219bfb915ed2cdf54c1937fe4cf3a", contract: "67cf9e7c3d5811148e78a2b3eb87db768692aa85ac30b5bc58f7315dad4cb73b"
    };
    const upstream = sha256(stable({ expectedFileCount: 1, expectedTotalBytes: "25000", extractionManifestSha256: envelope.extraction, ignoredFileCount: 0, projectedFileCount: 1, rawBundleSha256: envelope.raw, snapshotManifestSha256: envelope.snapshot, stagingSha256: envelope.staging }));
    const projectedDecisions = prepared.map((row) => ({ ...row.decisionBody, decisionFingerprint: row.decisionFingerprint })).sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"));
    const projection = sha256(stable(projectedDecisions));
    const imported = calculateObjectDomainParityImportSha256({ catalogProjectionRunId: catalogRunId, projectionManifestSha256: envelope.projectionManifest, projectionSha256: projection, upstreamEnvelopeSha256: upstream, targetSchemaSha256: envelope.schema, decisions: prepared.map((row) => ({ id: row.decisionId, fingerprint: row.decisionFingerprint })), rows: prepared.map((row) => ({ id: row.projectionId, fingerprint: row.binding })) }, envelope.contract);
    await database.withTransaction(async (transaction) => {
      await transaction.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,1,25000,25,1,0,'COMPLETE',?,?,?,?)", [commonRunId, envelope.raw, envelope.snapshot, envelope.extraction, envelope.staging, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      for (let index = 0; index < source.length; index += 1) {
        const record = source[index]!;
        await transaction.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [`s${String(index + 1).padStart(7, "0")}`, commonRunId, record.sourceSystem, record.sourceNamespace, record.sourcePathSha256, record.sourceContentSha256, record.logicalSourceName, record.sourcePointer, record.identityPointer, record.sourceLocatorSha256, null, record.occurrenceIndex, record.projectionLocator, record.recordDomain, record.recordKind, record.projectionStatus, null, null, null, record.payloadJson, record.payloadFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      }
      await transaction.execute("INSERT INTO data_migration_catalog_projection_runs(catalog_projection_run_id,common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,expected_total_bytes,projected_file_count,ignored_file_count,upstream_envelope_sha256,catalog_version,projection_manifest_sha256,target_schema_sha256,projection_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,1,25000,1,0,?,'SC-20260902-1',?,?,?,25,25,0,0,25,'COMPLETE',?,?,?,?)", [catalogRunId, commonRunId, envelope.raw, envelope.snapshot, envelope.extraction, upstream, envelope.projectionManifest, envelope.schema, projection, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      for (let index = 0; index < manifest.entries.length; index += 1) {
        const { entry, sourceRecord, itemId, decisionId, projectionId, receiptId, options, payload, origins, projection: projected, decisionFingerprint, binding, importedRow } = prepared[index]!;
        await transaction.execute("INSERT INTO data_migration_catalog_source_decisions(catalog_source_decision_id,catalog_projection_run_id,common_staging_record_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [decisionId, catalogRunId, `s${String(sourceRecord.occurrenceIndex + 1).padStart(7, "0")}`, entry.sourceLocatorSha256, entry.sourcePayloadFingerprint, "ITEM", "PROJECT", null, 1, decisionFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO data_migration_catalog_projection_records(catalog_projection_record_id,catalog_projection_run_id,catalog_source_decision_id,projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,target_payload_json,target_payload_fingerprint,value_origins_json,value_origins_fingerprint,reference_bindings_json,reference_bindings_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [projectionId, catalogRunId, decisionId, entry.sourcePointer, entry.sourceLocatorSha256, "GENERATED", "canonical_item_definitions", "item_id", "CANONICAL_ITEM_DEFINITIONS", ITEM25_IDENTITY_SOURCE_NAMESPACE, null, "CATALOG_PROVENANCE", projected.approval_sha256, projected.target_payload_json, projected.target_payload_fingerprint, projected.value_origins_json, projected.value_origins_fingerprint, projected.reference_bindings_json, projected.reference_bindings_fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?)", [itemId, "CANONICAL_ITEM_DEFINITIONS", audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?)", [`x${String(index + 1).padStart(7, "0")}`, itemId, "LEGACY_JSON", ITEM25_IDENTITY_SOURCE_NAMESPACE, entry.sourceLocatorSha256, binding, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [itemId, options.name, null, entry.itemKind, null, null, null, true, true, stable(options), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        if (index === 0) await transaction.execute("INSERT INTO data_migration_object_domain_import_runs(object_domain_import_run_id,catalog_projection_run_id,catalog_version,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [domainRunId, catalogRunId, "SC-20260902-1", projection, upstream, envelope.schema, envelope.contract, imported, 25, 25, 0, 0, 25, 25, "COMPLETE", audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO data_migration_object_domain_import_decisions(object_domain_import_decision_id,object_domain_import_run_id,catalog_source_decision_id,source_locator_sha256,decision_status,decision_reason,projected_row_count,decision_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [`e${String(index + 1).padStart(7, "0")}`, domainRunId, decisionId, entry.sourceLocatorSha256, "PROJECT", null, 1, decisionFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO data_migration_object_domain_import_records(object_domain_import_record_id,object_domain_import_run_id,catalog_projection_record_id,target_table_name,target_pk_column_name,target_pk_value,identity_locator_sha256,import_order,binding_fingerprint,imported_row_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [receiptId, domainRunId, projectionId, "canonical_item_definitions", "item_id", itemId, entry.sourceLocatorSha256, index, binding, importedRow, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      }
    });
  });

  after(async () => {
    try {
      await database.execute("DELETE FROM canonical_item_inventory_ledger_entries");
      await database.execute("DELETE FROM canonical_item_inventory_operations");
      await database.execute("DELETE FROM canonical_owned_item_stacks");
      await database.execute("DELETE FROM canonical_players");
      await database.execute("DELETE FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IMPORT_SOURCE_NAMESPACE]);
      await database.execute("DELETE FROM data_migration_object_domain_import_records WHERE object_domain_import_run_id=?", [domainRunId]);
      await database.execute("DELETE FROM data_migration_object_domain_import_decisions WHERE object_domain_import_run_id=?", [domainRunId]);
      await database.execute("DELETE FROM data_migration_object_domain_import_runs WHERE object_domain_import_run_id=?", [domainRunId]);
      await database.execute("DELETE FROM data_migration_catalog_projection_runs WHERE catalog_projection_run_id=?", [catalogRunId]);
      await database.execute("DELETE FROM data_migration_common_staging_runs WHERE common_staging_run_id=?", [commonRunId]);
      await database.execute("DELETE FROM canonical_item_definitions WHERE item_id LIKE 'i%'");
      await database.execute("DELETE FROM object_identity_crosswalks WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IDENTITY_SOURCE_NAMESPACE]);
      await database.execute("DELETE FROM object_identities WHERE object_type='CANONICAL_ITEM_DEFINITIONS'");
    } finally { await database.close(); }
  });

  it("fails closed, rolls back forced failure, exact-replays, uses CUID inventory, shadows, rolls back and restarts", async () => {
    const machineResult = { poolCount: 0, singleWinner: false, applyInsertedBindings: 0, replayDml: -1 };
    let collisionSequence = 0;
    const forced = new MariaItem25CanonicalDefinitionProvider(database, () => collisionSequence++ === 0 ? "z0000001" : "z0000001", 2, () => new Date("2026-09-05T10:30:00.000Z"));
    await assert.rejects(() => forced.apply(manifest, "lease2556-forced"), /CUID_COLLISION_RETRY_EXHAUSTED/);
    assert.deepEqual(await database.query("SELECT COUNT(*) bindings FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IMPORT_SOURCE_NAMESPACE]), [{ bindings: 0n }]);

    await database.execute("UPDATE data_migration_catalog_source_decisions SET source_payload_fingerprint=? WHERE catalog_projection_run_id=? ORDER BY catalog_source_decision_id LIMIT 1", [sha256("drift"), catalogRunId]);
    const validFingerprint = manifest.entries.find((entry) => entry.sourceLocatorSha256 === source.slice().sort((a, b) => a.sourcePointer.localeCompare(b.sourcePointer, "en"))[0]!.sourceLocatorSha256)!.sourcePayloadFingerprint;
    const preflight = new MariaItem25CanonicalDefinitionProvider(database, () => "b0000001");
    await assert.rejects(() => preflight.apply(manifest, "lease2556-drift"), /DECISION_FINGERPRINT_DRIFT/);
    assert.deepEqual(await database.query("SELECT COUNT(*) bindings FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IMPORT_SOURCE_NAMESPACE]), [{ bindings: 0n }]);
    await database.execute("UPDATE data_migration_catalog_source_decisions SET source_payload_fingerprint=? WHERE catalog_projection_run_id=? ORDER BY catalog_source_decision_id LIMIT 1", [validFingerprint, catalogRunId]);

    await database.execute("INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('w0000001','i0000002','LEGACY_JSON',?,?,?,?,?,?)", [ITEM25_IMPORT_SOURCE_NAMESPACE, manifest.entries[0]!.sourcePointer, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await assert.rejects(() => preflight.apply(manifest, "lease2556-partial"), /PARTIAL_STATE/);
    await database.execute("DELETE FROM canonical_item_definition_imports WHERE item_definition_import_id='w0000001'");

    const leftDatabase = createDatabaseClient(databaseConfig), rightDatabase = createDatabaseClient(databaseConfig);
    machineResult.poolCount = 2;
    try {
      let leftSequence = 0, rightSequence = 0;
      const [left, right] = await Promise.all([
        new MariaItem25CanonicalDefinitionProvider(leftDatabase, () => `l${String(++leftSequence).padStart(7, "0")}`).apply(manifest, "lease2556-concurrent-left"),
        new MariaItem25CanonicalDefinitionProvider(rightDatabase, () => `r${String(++rightSequence).padStart(7, "0")}`).apply(manifest, "lease2556-concurrent-right")
      ]);
      assert.deepEqual([left.insertedBindings, right.insertedBindings].sort((a, b) => a - b), [0, 25]);
      assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
      machineResult.singleWinner = [left.insertedBindings, right.insertedBindings].filter((value) => value === 25).length === 1;
      assert.deepEqual(await database.query("SELECT COUNT(*) bindings FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IMPORT_SOURCE_NAMESPACE]), [{ bindings: 25n }]);
    } finally { await leftDatabase.close(); await rightDatabase.close(); }
    assert.equal(await preflight.rollback(manifest), 25);

    let sequence = 0;
    const provider = new MariaItem25CanonicalDefinitionProvider(database, () => `b${String(++sequence).padStart(7, "0")}`, 8, () => new Date("2026-09-05T10:30:00.000Z"));
    const applied = await provider.apply(manifest, "lease2556-apply");
    assert.deepEqual(applied, { insertedBindings: 25, replayed: false, manifestSha256: manifest.manifestSha256 });
    machineResult.applyInsertedBindings = applied.insertedBindings;
    const beforeReplay = await database.query("SELECT COUNT(*) bindings FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IMPORT_SOURCE_NAMESPACE]);
    assert.deepEqual(beforeReplay, [{ bindings: 25n }]);
    const replayed = await provider.apply(manifest, "lease2556-replay");
    assert.deepEqual(replayed, { insertedBindings: 0, replayed: true, manifestSha256: manifest.manifestSha256 });
    machineResult.replayDml = replayed.insertedBindings;
    assert.deepEqual(await database.query("SELECT COUNT(*) bindings FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=?", [ITEM25_IMPORT_SOURCE_NAMESPACE]), beforeReplay);

    let inventorySequence = 0;
    const inventory = new CanonicalItemInventoryRepository(database, () => `n${String(++inventorySequence).padStart(7, "0")}`, 8, () => new Date("2026-09-05T10:30:00.000Z"));
    const player = await inventory.registerPlayer({ actor: "lease2556-inventory", sourceSystem: "SYNTHETIC", sourceIdentifier: "lease2556-player" });
    const firstItemId = (await database.query<Array<{ item_id: string }>>("SELECT item_id FROM canonical_item_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace=? ORDER BY source_identifier LIMIT 1", [ITEM25_IMPORT_SOURCE_NAMESPACE]))[0]!.item_id;
    assert.deepEqual(await inventory.changeStackQuantity({ actor: "lease2556-inventory", playerId: player.playerId, itemId: firstItemId, requestKey: "lease2556-stack", quantityDelta: 3n, reasonType: "ITEM25_BINDING_TEST" }), { quantity: 3n, replayed: false });
    assert.deepEqual(await provider.shadow(manifest), { exactBindings: 25, manifestSha256: manifest.manifestSha256 });

    const preservedBefore = await database.query("SELECT (SELECT COUNT(*) FROM canonical_item_definitions) definitions,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_namespace=?) crosswalks,(SELECT COUNT(*) FROM data_migration_object_domain_import_records WHERE object_domain_import_run_id=?) receipts,(SELECT COUNT(*) FROM canonical_owned_item_stacks) stacks", [ITEM25_IDENTITY_SOURCE_NAMESPACE, domainRunId]);
    assert.equal(await provider.rollback(manifest), 25);
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM canonical_item_definitions) definitions,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_namespace=?) crosswalks,(SELECT COUNT(*) FROM data_migration_object_domain_import_records WHERE object_domain_import_run_id=?) receipts,(SELECT COUNT(*) FROM canonical_owned_item_stacks) stacks", [ITEM25_IDENTITY_SOURCE_NAMESPACE, domainRunId]), preservedBefore);
    assert.equal(await provider.rollback(manifest), 0);
    assert.equal((await provider.apply(manifest, "lease2556-restart")).insertedBindings, 25);
    assert.equal(await provider.rollback(manifest), 25);
    console.log(`ITEM25_MARIA_MACHINE_RESULT=${JSON.stringify(machineResult)}`);
  });
});
