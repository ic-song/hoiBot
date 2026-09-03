import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRootInput = process.env.GATE7_CONSUMER_RUNTIME;
if (!runtimeRootInput) throw new Error("GATE7_CONSUMER_RUNTIME is required.");
const runtimeRoot = resolve(runtimeRootInput);
const controlRoot = resolve(runtimeRoot, "..", "migration-control");
const moduleUrl = (path: string): string => pathToFileURL(join(runtimeRoot, path)).href;
const { createDatabaseClient } = await import(moduleUrl("src/database.ts"));
const { MariaRawLandingRepository, calculateRawLandingBundleSha256 } = await import(moduleUrl("src/data-migration/maria-raw-landing-repository.ts"));
const { MariaCommonStagingRepository, calculateCommonStagingManifestSha256, extractCommonStagingRecords } = await import(moduleUrl("src/data-migration/common-staging-extractor.ts"));
const { MariaCatalogProjectionRepository, buildCatalogProjectionPlan, calculateCatalogProjectionManifestSha256, calculateCatalogTargetSchemaSha256, calculateLegacyCatalogTargetSchemaSha256s } = await import(moduleUrl("src/data-migration/catalog-projection-provider.ts"));

const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value: any): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Gate7 canonical JSON refuses unsafe numbers.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const mode = process.argv[2] ?? "first";
if (!new Set(["first", "replay", "rollback"]).has(mode)) throw new Error("mode must be first, replay, or rollback");

const database = createDatabaseClient({
  enabled: true,
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  name: process.env.DATABASE_NAME,
  connectionLimit: 5,
  connectTimeoutMs: 5_000
});

const payload = Buffer.from(JSON.stringify({
  catalog: {
    item: { item_name: "다이아상자💎(/다이아상자오픈)", quantity: "2" },
    missingFurniture: { display_name: "미확정 합성 가구" },
    nonObject: { note: "비오브젝트 합성 입력" }
  },
  capturedAt: "2026-09-03 18:30:00"
}), "utf8");
const sourcePathSha256 = sha("gate7-shadow/catalog.json");
const sourceContentSha256 = sha(payload);
const snapshotManifestSha256 = sha("gate7-shadow-snapshot-v1");
const storageName = `${sourcePathSha256}.bin`;
const rawBundleSha256 = calculateRawLandingBundleSha256([{ pathSha256: sourcePathSha256, contentSha256: sourceContentSha256, size: payload.byteLength, storageName }]);
const rawManifest = {
  format: "hoibot-raw-landing-bundle-v1",
  snapshotManifestSha256,
  fileCount: 1,
  totalBytes: payload.byteLength,
  bundleSha256: rawBundleSha256,
  entries: [{ pathSha256: sourcePathSha256, contentSha256: sourceContentSha256, size: payload.byteLength, storageName }]
};
const commonManifest = {
  format: "hoibot-common-staging-extraction-manifest-v1",
  rawBundleSha256,
  snapshotManifestSha256,
  actor: "gate7-shadow",
  entries: [{
    sourcePathSha256,
    sourceContentSha256,
    logicalSourceName: "synthetic/catalog.json",
    sourceNamespace: "gate7.synthetic",
    disposition: "PROJECT",
    records: [
      { sourcePointer: "/catalog/item", recordDomain: "ITEM", recordKind: "CATALOG_DEFINITION", projectionLocator: "item", projectionStatus: "PROJECT", quantityPointer: "/catalog/item/quantity", observedTimePointer: "/capturedAt" },
      { sourcePointer: "/catalog/missingFurniture", recordDomain: "FURNITURE", recordKind: "CATALOG_DEFINITION", projectionLocator: "furniture", projectionStatus: "PROJECT", observedTimePointer: "/capturedAt" },
      { sourcePointer: "/catalog/nonObject", recordDomain: "NON_OBJECT", recordKind: "NON_OBJECT", projectionLocator: "non-object", projectionStatus: "PROJECT", observedTimePointer: "/capturedAt" }
    ]
  }]
};
const expectedCommon = extractCommonStagingRecords(commonManifest, new Map([[sourcePathSha256, payload]]));

const schemaBytes = readFileSync(join(controlRoot, "contracts/object-domain-import-target-schema.v1.json"));
const schema = JSON.parse(schemaBytes.toString("utf8"));
const schemaLf = `${JSON.stringify(schema, null, 2)}\n`;
const schemaCrlf = schemaLf.replace(/\n/g, "\r\n");
assert.equal(calculateCatalogTargetSchemaSha256(schemaLf), calculateCatalogTargetSchemaSha256(schemaCrlf));
assert.deepEqual(calculateLegacyCatalogTargetSchemaSha256s(schemaLf), calculateLegacyCatalogTargetSchemaSha256s(schemaCrlf));
const bindings = JSON.parse(readFileSync(join(controlRoot, "contracts/object-domain-import-identity-bindings.v1.json"), "utf8"));
const objectModel = JSON.parse(readFileSync(join(controlRoot, "contracts/object-data-model-standard.v1.json"), "utf8"));
const fieldMap = JSON.parse(readFileSync(join(controlRoot, "contracts/object-domain-import-field-map.v1.json"), "utf8"));
const projectionFixture = JSON.parse(readFileSync(join(controlRoot, "fixtures/synthetic-relational/data-migration-catalog-projection-v1.json"), "utf8"));
const policy = {
  targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaBytes.toString("utf8")),
  legacyTargetSchemaSha256s: calculateLegacyCatalogTargetSchemaSha256s(schemaBytes.toString("utf8")),
  columns: schema.columns,
  generatedCuidBindings: bindings.generatedCuidBindings,
  reusedPrimaryKeys: bindings.reusedPrimaryKeys,
  foreignKeys: objectModel.tables.flatMap((table: any) => (table.foreignKeys ?? []).map((foreignKey: any) => ({ table: table.table, ...foreignKey }))),
  domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping: any) => [mapping.domain, mapping.targetTables])),
  quarantineReasons: fieldMap.recordQuarantine
};
assert.equal(policy.targetSchemaSha256, "2d0229891ffaaf486ec9fe7f786d362b90d219bfb915ed2cdf54c1937fe4cf3a");

try {
  const migrations = (await database.query(
    "SELECT COUNT(*) migration_count,SUM(version='457_data_migration_common_staging.sql') migration457,SUM(version='458_data_migration_catalog_projection.sql') migration458,SUM(version='459_catalog_projection_upstream_envelope.sql') migration459 FROM schema_migrations"
  ))[0];
  const expectedMigrationCount = process.env.WBS742_GATE7_COMBINED === "true" ? 448 : 447;
  assert.deepEqual([Number(migrations.migration_count), Number(migrations.migration457), Number(migrations.migration458), Number(migrations.migration459)], [expectedMigrationCount, 1, 1, 1]);
  const raw = await new MariaRawLandingRepository(database).importBundle(rawManifest, async () => payload);
  const rawFiles = await database.query(
    "SELECT source_path_sha256,source_content_sha256,CAST(size_bytes AS CHAR) size_bytes,payload FROM data_migration_raw_files WHERE run_id=?",
    [raw.runId]
  );
  const commonRepository = new MariaCommonStagingRepository(database);
  const common = await commonRepository.extractAndStage(commonManifest);
  const run = (await database.query(
    "SELECT raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE common_staging_run_id=?",
    [common.commonStagingRunId]
  ))[0];
  const records = await database.query(
    "SELECT common_staging_record_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,CAST(quantity_value AS CHAR) quantity_value,observed_time,CAST(payload_json AS CHAR) payload_json,payload_fingerprint FROM data_migration_common_staging_records WHERE common_staging_run_id=? ORDER BY source_locator_sha256",
    [common.commonStagingRunId]
  );
  const expectedRecords = [...expectedCommon.records].sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"));
  const comparableRecords = records.map((record: any) => ({
    sourceSystem: record.source_system, sourceNamespace: record.source_namespace, sourcePathSha256: record.source_path_sha256,
    sourceContentSha256: record.source_content_sha256, logicalSourceName: record.logical_source_name, sourcePointer: record.source_pointer,
    identityPointer: record.identity_pointer, sourceLocatorSha256: record.source_locator_sha256, ownerLocatorSha256: record.owner_locator_sha256,
    occurrenceIndex: Number(record.occurrence_index), projectionLocator: record.projection_locator, recordDomain: record.record_domain,
    recordKind: record.record_kind, projectionStatus: record.projection_status, quarantineReason: record.quarantine_reason,
    quantityValue: record.quantity_value, observedTime: record.observed_time, payloadJson: record.payload_json, payloadFingerprint: record.payload_fingerprint
  }));
  assert.deepEqual(comparableRecords, expectedRecords);
  const expectedByDomain = new Map(expectedRecords.map((record: any) => [record.recordDomain, record]));
  const item: any = expectedByDomain.get("ITEM");
  const furniture: any = expectedByDomain.get("FURNITURE");
  const nonObject: any = expectedByDomain.get("NON_OBJECT");
  assert.ok(item && furniture && nonObject);

  const itemOutput = structuredClone(projectionFixture.sources.find((source: any) => source.decisionStatus === "PROJECT").outputs[0]);
  itemOutput.payload.item_name = "다이아상자💎(/다이아상자오픈)";
  const projectionManifest = {
    format: "hoibot-catalog-projection-manifest-v1",
    catalogVersion: "SC-20260902-1",
    commonStagingRunId: common.commonStagingRunId,
    commonStagingSha256: expectedCommon.stagingSha256,
    commonStagingEnvelope: {
      rawBundleSha256,
      snapshotManifestSha256,
      extractionManifestSha256: expectedCommon.extractionManifestSha256,
      expectedFileCount: 1,
      expectedTotalBytes: String(payload.byteLength),
      projectedFileCount: 1,
      ignoredFileCount: 0
    },
    targetSchemaSha256: policy.targetSchemaSha256,
    actor: "gate7-shadow",
    sources: [
      { sourceLocatorSha256: item.sourceLocatorSha256, sourcePayloadFingerprint: item.payloadFingerprint, recordDomain: "ITEM", decisionStatus: "PROJECT", outputs: [itemOutput] },
      { sourceLocatorSha256: furniture.sourceLocatorSha256, sourcePayloadFingerprint: furniture.payloadFingerprint, recordDomain: "FURNITURE", decisionStatus: "QUARANTINE", decisionReason: "DEFINITION_REFERENCE_MISSING", outputs: [] },
      { sourceLocatorSha256: nonObject.sourceLocatorSha256, sourcePayloadFingerprint: nonObject.payloadFingerprint, recordDomain: "NON_OBJECT", decisionStatus: "IGNORE", decisionReason: "NOT_OBJECT_DOMAIN_INPUT", outputs: [] }
    ]
  };
  const expectedProjectionPlan = buildCatalogProjectionPlan(projectionManifest, policy);
  const projectionRepository = new MariaCatalogProjectionRepository(database);
  const projection = await projectionRepository.project(projectionManifest, policy);
  const projectionRun = (await database.query(
    "SELECT projection_manifest_sha256,upstream_envelope_sha256,target_schema_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status FROM data_migration_catalog_projection_runs WHERE catalog_projection_run_id=?",
    [projection.catalogProjectionRunId]
  ))[0];
  const decisions = await database.query(
    "SELECT source_locator_sha256,source_payload_fingerprint,decision_status FROM data_migration_catalog_source_decisions WHERE catalog_projection_run_id=? ORDER BY source_locator_sha256",
    [projection.catalogProjectionRunId]
  );
  const projectedRows = await database.query(
    "SELECT projection_locator,CAST(target_payload_json AS CHAR) target_payload_json,target_payload_fingerprint FROM data_migration_catalog_projection_records WHERE catalog_projection_run_id=?",
    [projection.catalogProjectionRunId]
  );

  assert.equal(rawFiles.length, 1);
  assert.equal(rawFiles[0].source_path_sha256, sourcePathSha256);
  assert.equal(rawFiles[0].source_content_sha256, sourceContentSha256);
  assert.equal(rawFiles[0].size_bytes, String(payload.byteLength));
  assert.deepEqual(Buffer.from(rawFiles[0].payload), payload);
  assert.equal(run.run_status, "COMPLETE");
  assert.equal(run.raw_bundle_sha256, rawBundleSha256);
  assert.equal(run.snapshot_manifest_sha256, snapshotManifestSha256);
  assert.equal(Number(run.expected_file_count), 1);
  assert.equal(run.expected_total_bytes, String(payload.byteLength));
  assert.equal(run.extraction_manifest_sha256, expectedCommon.extractionManifestSha256);
  assert.equal(run.staging_sha256, expectedCommon.stagingSha256);
  assert.equal(Number(run.expected_record_count), 3);
  assert.equal(Number(run.projected_file_count), 1);
  assert.equal(Number(run.ignored_file_count), 0);
  assert.equal(records.length, 3);
  assert.equal(new Set(expectedRecords.map((record: any) => record.sourceLocatorSha256)).size, 3);
  assert.equal(item.quantityValue, "2");
  assert.equal(item.observedTime, "2026-09-03 18:30:00");
  assert.equal(projectionRun.run_status, "COMPLETE");
  assert.deepEqual([Number(projectionRun.expected_source_count), Number(projectionRun.projected_source_count), Number(projectionRun.quarantined_source_count), Number(projectionRun.ignored_source_count), Number(projectionRun.projected_row_count)], [3, 1, 1, 1, 1]);
  assert.equal(projectionRun.projection_manifest_sha256, calculateCatalogProjectionManifestSha256(projectionManifest, policy));
  const expectedUpstreamEnvelopeSha256 = sha(canonicalJson({ ...projectionManifest.commonStagingEnvelope, stagingSha256: expectedCommon.stagingSha256 }));
  assert.equal(projectionRun.upstream_envelope_sha256, expectedUpstreamEnvelopeSha256);
  assert.equal(projectionRun.target_schema_sha256, policy.targetSchemaSha256);
  assert.equal(decisions.length, records.length);
  assert.deepEqual(new Set(decisions.map((decision: any) => decision.source_locator_sha256)), new Set(expectedRecords.map((record: any) => record.sourceLocatorSha256)));
  for (const decision of decisions) assert.equal(decision.source_payload_fingerprint, expectedRecords.find((record: any) => record.sourceLocatorSha256 === decision.source_locator_sha256).payloadFingerprint);
  assert.deepEqual([...decisions.map((decision: any) => decision.decision_status)].sort(), ["IGNORE", "PROJECT", "QUARANTINE"]);
  assert.equal(projectedRows.length, 1);
  assert.equal(projectedRows[0].projection_locator, itemOutput.projectionLocator);
  assert.deepEqual(JSON.parse(projectedRows[0].target_payload_json), itemOutput.payload);
  assert.equal(projectedRows[0].target_payload_fingerprint, expectedProjectionPlan.decisions.find((decision: any) => decision.decisionStatus === "PROJECT").outputs[0].targetPayloadFingerprint);

  if (mode === "first") {
    assert.deepEqual([raw.insertedFiles, common.insertedRecords, projection.insertedDecisions, projection.insertedProjectionRecords], [1, 3, 3, 1]);
    assert.deepEqual([raw.replayed, common.replayed, projection.replayed], [false, false, false]);
  } else {
    assert.deepEqual([raw.insertedFiles, common.insertedRecords, projection.insertedDecisions, projection.insertedProjectionRecords], [0, 0, 0, 0]);
    assert.deepEqual([raw.replayed, common.replayed, projection.replayed], [true, true, true]);
  }

  const result: any = {
    mode,
    migrations: { total: Number(migrations.migration_count), migration457: Number(migrations.migration457), migration458: Number(migrations.migration458), migration459: Number(migrations.migration459) },
    raw: { runId: raw.runId, insertedFiles: raw.insertedFiles, replayed: raw.replayed, fileCount: 1, totalBytes: payload.byteLength, bundleSha256: rawBundleSha256 },
    common: { runId: common.commonStagingRunId, insertedRecords: common.insertedRecords, replayed: common.replayed, stagingSha256: expectedCommon.stagingSha256, extractionManifestSha256: expectedCommon.extractionManifestSha256, recordCount: expectedRecords.length, uniqueLocators: new Set(expectedRecords.map((record: any) => record.sourceLocatorSha256)).size, quantity: item.quantityValue, observedTime: item.observedTime },
    projection: { runId: projection.catalogProjectionRunId, insertedDecisions: projection.insertedDecisions, insertedRecords: projection.insertedProjectionRecords, replayed: projection.replayed, upstreamEnvelopeSha256: projectionRun.upstream_envelope_sha256, decisionCounts: { PROJECT: 1, QUARANTINE: 1, IGNORE: 1 }, unexplainedDiffs: 0 }
  };

  if (mode === "rollback") {
    assert.equal(await projectionRepository.rollback(common.commonStagingRunId, projectionManifest.catalogVersion, calculateCatalogProjectionManifestSha256(projectionManifest, policy)), 1);
    assert.equal(await commonRepository.rollback(rawBundleSha256, calculateCommonStagingManifestSha256(commonManifest)), 1);
    assert.equal(await new MariaRawLandingRepository(database).rollbackRun(rawBundleSha256), 1);
    const counts = (await database.query("SELECT CAST((SELECT COUNT(*) FROM data_migration_raw_runs) AS CHAR) raw_count,CAST((SELECT COUNT(*) FROM data_migration_common_staging_runs) AS CHAR) common_count,CAST((SELECT COUNT(*) FROM data_migration_catalog_projection_runs) AS CHAR) projection_count"))[0];
    assert.deepEqual(counts, { raw_count: "0", common_count: "0", projection_count: "0" });
    result.rollbackCounts = counts;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await database.close();
}
