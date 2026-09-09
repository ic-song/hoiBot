import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { calculateCatalogTargetSchemaSha256, calculateLegacyCatalogTargetSchemaSha256s, type CatalogForeignKeyBinding, type CatalogGeneratedIdentityBinding, type CatalogProjectionManifest, type CatalogProjectionPolicy, type CatalogReusedIdentityBinding, type CatalogTargetSchemaColumn } from "../../src/data-migration/catalog-projection-provider.js";
import { extractCommonStagingRecords, type CommonStagingExtractionManifest } from "../../src/data-migration/common-staging-extractor.js";
import { calculateRawLandingBundleSha256 } from "../../src/data-migration/maria-raw-landing-repository.js";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export interface StagingProjectionChainFixture {
  payload: Buffer;
  sourcePathSha256: string;
  sourceContentSha256: string;
  commonManifest: CommonStagingExtractionManifest;
  catalogManifest: CatalogProjectionManifest;
  failureManifest: CatalogProjectionManifest;
  policy: CatalogProjectionPolicy;
  payloadFingerprints: string[];
}

export function createStagingProjectionChainFixture(nonce: string, commonStagingRunId: string): StagingProjectionChainFixture {
  const payload = Buffer.from(JSON.stringify({ records: [
    { item_name: "다이아상자💎(/다이아상자오픈)" },
    { furniture_name: "격리 가구", legacy_reference: "ambiguous" },
    { log_message: "object domain 밖의 입력" }
  ] }));
  const sourcePathSha256 = sha(`lease2620-chain-${nonce}`);
  const sourceContentSha256 = sha(payload);
  const rawBundleSha256 = calculateRawLandingBundleSha256([{ pathSha256: sourcePathSha256, contentSha256: sourceContentSha256, size: payload.byteLength, storageName: `${sourcePathSha256}.bin` }]);
  const commonManifest: CommonStagingExtractionManifest = {
    format: "hoibot-common-staging-extraction-manifest-v1",
    rawBundleSha256,
    snapshotManifestSha256: sha(`lease2620-snapshot-${nonce}`),
    actor: "lease2620-chain",
    entries: [{
      sourcePathSha256, sourceContentSha256, logicalSourceName: "sealed/lease2620.json", sourceNamespace: "lease2620", disposition: "PROJECT",
      records: [
        { sourcePointer: "/records/0", projectionLocator: "item-definition-0", recordDomain: "ITEM", recordKind: "ITEM_DEFINITION", projectionStatus: "PROJECT" },
        { sourcePointer: "/records/1", projectionLocator: "furniture-quarantine-0", recordDomain: "FURNITURE", recordKind: "FURNITURE_DEFINITION", projectionStatus: "QUARANTINE", quarantineReason: "DEFINITION_REFERENCE_AMBIGUOUS" },
        { sourcePointer: "/records/2", projectionLocator: "non-object-0", recordDomain: "NON_OBJECT", recordKind: "NON_OBJECT_RECORD", projectionStatus: "PROJECT" }
      ]
    }]
  };
  const extraction = extractCommonStagingRecords(commonManifest, new Map([[sourcePathSha256, payload]]));
  const schemaText = readFileSync(new URL("../../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url), "utf8");
  const schema = JSON.parse(schemaText) as { columns: CatalogTargetSchemaColumn[] };
  const bindings = JSON.parse(readFileSync(new URL("../../../migration-control/contracts/object-domain-import-identity-bindings.v1.json", import.meta.url), "utf8")) as { generatedCuidBindings: CatalogGeneratedIdentityBinding[]; reusedPrimaryKeys: CatalogReusedIdentityBinding[] };
  const objectModel = JSON.parse(readFileSync(new URL("../../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
  const fieldMap = JSON.parse(readFileSync(new URL("../../../migration-control/contracts/object-domain-import-field-map.v1.json", import.meta.url), "utf8")) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
  const policy: CatalogProjectionPolicy = {
    targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaText), legacyTargetSchemaSha256s: calculateLegacyCatalogTargetSchemaSha256s(schemaText), columns: schema.columns,
    generatedCuidBindings: bindings.generatedCuidBindings, reusedPrimaryKeys: bindings.reusedPrimaryKeys,
    foreignKeys: objectModel.tables.flatMap((table): CatalogForeignKeyBinding[] => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
    domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])), quarantineReasons: fieldMap.recordQuarantine
  };
  const [item, furniture, nonObject] = extraction.records;
  if (!item || !furniture || !nonObject) throw new Error("LEASE2620_FIXTURE_EXTRACTION_DRIFT");
  const output = {
    projectionLocator: "item-definition-0", identityMode: "GENERATED" as const, targetTable: "canonical_item_definitions", targetPkColumn: "item_id", targetObjectType: "CANONICAL_ITEM_DEFINITIONS", targetSourceNamespace: "object-import.item.canonical_item_definitions",
    payload: { item_name: "다이아상자💎(/다이아상자오픈)", item_description: null, item_kind: "BOX", item_grade: null, price_amount: null, price_currency_source_identifier: null, stackable_flag: true, active_flag: true, definition_options: null },
    valueOrigins: { item_name: "SOURCE_EXACT" as const, item_description: "SOURCE_ABSENT" as const, item_kind: "APPROVED_CATALOG" as const, item_grade: "SOURCE_ABSENT" as const, price_amount: "SOURCE_ABSENT" as const, price_currency_source_identifier: "SOURCE_ABSENT" as const, stackable_flag: "APPROVED_CATALOG" as const, active_flag: "APPROVED_CATALOG" as const, definition_options: "SOURCE_ABSENT" as const },
    sourceBindings: { item_name: "/item_name", item_description: "/item_description", item_grade: "/item_grade", price_amount: "/price_amount", price_currency_source_identifier: "/price_currency_source_identifier", definition_options: "/definition_options" }, referenceBindings: [], approvalKind: "CATALOG_PROVENANCE" as const, approvalSha256: sha(`lease2620-approval-${nonce}`)
  };
  const commonStagingEnvelope = { rawBundleSha256, snapshotManifestSha256: commonManifest.snapshotManifestSha256, extractionManifestSha256: extraction.extractionManifestSha256, expectedFileCount: 1, expectedTotalBytes: String(payload.byteLength), projectedFileCount: 1, ignoredFileCount: 0 };
  const catalogManifest: CatalogProjectionManifest = {
    format: "hoibot-catalog-projection-manifest-v1", catalogVersion: "SC-20260902-1", commonStagingRunId, commonStagingSha256: extraction.stagingSha256, commonStagingEnvelope, targetSchemaSha256: policy.targetSchemaSha256, actor: "lease2620-chain",
    sources: [
      { sourceLocatorSha256: item.sourceLocatorSha256, sourcePayloadFingerprint: item.payloadFingerprint, recordDomain: item.recordDomain, decisionStatus: "PROJECT", outputs: [output] },
      { sourceLocatorSha256: furniture.sourceLocatorSha256, sourcePayloadFingerprint: furniture.payloadFingerprint, recordDomain: furniture.recordDomain, decisionStatus: "QUARANTINE", decisionReason: "DEFINITION_REFERENCE_AMBIGUOUS", outputs: [] },
      { sourceLocatorSha256: nonObject.sourceLocatorSha256, sourcePayloadFingerprint: nonObject.payloadFingerprint, recordDomain: nonObject.recordDomain, decisionStatus: "IGNORE", decisionReason: "NOT_OBJECT_DOMAIN_INPUT", outputs: [] }
    ]
  };
  const failureOutput = { ...output, payload: { ...output.payload, item_kind: "MATERIAL" }, approvalSha256: sha(`lease2620-failure-approval-${nonce}`) };
  const failureManifest: CatalogProjectionManifest = { ...catalogManifest, actor: "lease2620-fault", sources: [{ ...catalogManifest.sources[0]!, outputs: [failureOutput] }, ...catalogManifest.sources.slice(1)] };
  return { payload, sourcePathSha256, sourceContentSha256, commonManifest, catalogManifest, failureManifest, policy, payloadFingerprints: extraction.records.map((record) => record.payloadFingerprint) };
}
