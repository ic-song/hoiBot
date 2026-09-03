import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildCatalogProjectionPlan,
  calculateCatalogTargetSchemaSha256,
  calculateLegacyCatalogTargetSchemaSha256s,
  type CatalogForeignKeyBinding,
  type CatalogProjectionManifest,
  type CatalogProjectionPolicy,
  type CatalogTargetSchemaColumn
} from "../src/data-migration/catalog-projection-provider.js";
import {
  buildObjectDomainImportPlan,
  calculateObjectDomainImportSemanticSha256,
  stableDomainImportJson,
  type DomainImportPolicy
} from "../src/data-migration/object-domain-importer.js";

const contractRoot = new URL("../../migration-control/contracts/", import.meta.url);
const fixtureRoot = new URL("../../migration-control/fixtures/synthetic-relational/", import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, contractRoot), "utf8");
const parse = <T>(name: string): T => JSON.parse(read(name)) as T;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const schemaText = read("object-domain-import-target-schema.v1.json");
const schema = JSON.parse(schemaText) as { columns: CatalogTargetSchemaColumn[] };
const identityText = read("object-domain-import-identity-bindings.v1.json");
const identity = JSON.parse(identityText) as {
  generatedCuidBindings: DomainImportPolicy["generatedBindings"];
  reusedPrimaryKeys: DomainImportPolicy["reusedBindings"];
};
const objectModelText = read("object-data-model-standard.v1.json");
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<Omit<CatalogForeignKeyBinding, "table">> }> };
const dispositionText = read("object-domain-import-disposition.v1.json");
const disposition = JSON.parse(dispositionText) as { definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[] };
const fieldMapText = read("object-domain-import-field-map.v1.json");
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const importContractText = read("data-migration-object-domain-import.v1.json");
const importContract = JSON.parse(importContractText) as {
  directTargetCount: number; targetColumnCount: number; definitionTargetCount: number;
  componentSemanticSha256: DomainImportPolicy["componentSemanticSha256"];
};
const fixture = JSON.parse(readFileSync(new URL("data-migration-catalog-projection-v1.json", fixtureRoot), "utf8")) as CatalogProjectionManifest;
const importFixture = JSON.parse(readFileSync(new URL("data-migration-object-domain-import-v1.json", fixtureRoot), "utf8")) as {
  directTargetCount: number; targetColumnCount: number; definitionTargetCount: number; syntheticProjectionRowCount: number;
};
const foreignKeys = objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey })));
const directTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
const domainTargets = Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables]));
const targetSchemaSha256 = calculateCatalogTargetSchemaSha256(schemaText);
const componentSemanticSha256 = {
  identityBindings: calculateObjectDomainImportSemanticSha256(identityText),
  objectModel: calculateObjectDomainImportSemanticSha256(objectModelText),
  disposition: calculateObjectDomainImportSemanticSha256(dispositionText),
  fieldMap: calculateObjectDomainImportSemanticSha256(fieldMapText)
};
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
  directTargets,
  definitionTargets: disposition.definitionSeed,
  domainTargets,
  quarantineReasons: fieldMap.recordQuarantine
};

function importerInput() {
  const plan = buildCatalogProjectionPlan(fixture, catalogPolicy);
  const ids = new Map(plan.decisions.map((decision, index) => [decision.sourceLocatorSha256, `c${String(index + 1).padStart(7, "0")}`]));
  const decisions = plan.decisions.map((decision) => ({
    catalog_source_decision_id: ids.get(decision.sourceLocatorSha256)!,
    source_locator_sha256: decision.sourceLocatorSha256,
    source_payload_fingerprint: decision.sourcePayloadFingerprint,
    record_domain: decision.recordDomain,
    decision_status: decision.decisionStatus,
    decision_reason: decision.decisionReason,
    projected_row_count: decision.outputs.length,
    decision_fingerprint: decision.decisionFingerprint,
    record_kind: "SYNTHETIC",
    staging_projection_status: decision.decisionStatus,
    staging_quarantine_reason: decision.decisionReason,
    staging_source_locator_sha256: decision.sourceLocatorSha256,
    staging_payload_fingerprint: decision.sourcePayloadFingerprint,
    staging_record_domain: decision.recordDomain
  }));
  let recordIndex = 0;
  const rows = plan.decisions.flatMap((decision) => decision.outputs.map((output) => ({
    catalog_projection_record_id: `r${String(++recordIndex).padStart(7, "0")}`,
    catalog_source_decision_id: ids.get(decision.sourceLocatorSha256)!,
    projection_locator: output.projectionLocator,
    identity_locator_sha256: output.identityLocatorSha256,
    identity_mode: output.identityMode,
    target_table_name: output.targetTable,
    target_pk_column_name: output.targetPkColumn,
    target_object_type: output.targetObjectType,
    target_source_namespace: output.targetSourceNamespace,
    source_role: output.sourceRole ?? null,
    approval_kind: output.approvalKind ?? null,
    approval_sha256: output.approvalSha256 ?? null,
    target_payload_json: output.targetPayloadJson,
    target_payload_fingerprint: output.targetPayloadFingerprint,
    value_origins_json: output.valueOriginsJson,
    value_origins_fingerprint: output.valueOriginsFingerprint,
    reference_bindings_json: output.referenceBindingsJson,
    reference_bindings_fingerprint: output.referenceBindingsFingerprint,
    record_domain: decision.recordDomain,
    decision_status: decision.decisionStatus
  })));
  const counts = (status: string) => decisions.filter((decision) => decision.decision_status === status).length;
  const envelope = fixture.commonStagingEnvelope;
  const upstreamEnvelopeSha256 = sha256(stableDomainImportJson({
    expectedFileCount: envelope.expectedFileCount, expectedTotalBytes: envelope.expectedTotalBytes,
    extractionManifestSha256: envelope.extractionManifestSha256, ignoredFileCount: envelope.ignoredFileCount,
    projectedFileCount: envelope.projectedFileCount, rawBundleSha256: envelope.rawBundleSha256,
    snapshotManifestSha256: envelope.snapshotManifestSha256, stagingSha256: fixture.commonStagingSha256
  }));
  const run = {
    catalog_projection_run_id: "p1234567", common_staging_run_id: fixture.commonStagingRunId,
    catalog_version: fixture.catalogVersion, projection_manifest_sha256: plan.projectionManifestSha256,
    raw_bundle_sha256: envelope.rawBundleSha256, snapshot_manifest_sha256: envelope.snapshotManifestSha256,
    extraction_manifest_sha256: envelope.extractionManifestSha256, expected_file_count: envelope.expectedFileCount,
    expected_total_bytes: envelope.expectedTotalBytes, projected_file_count: envelope.projectedFileCount,
    ignored_file_count: envelope.ignoredFileCount, target_schema_sha256: fixture.targetSchemaSha256,
    projection_sha256: plan.projectionSha256, upstream_envelope_sha256: upstreamEnvelopeSha256,
    expected_source_count: decisions.length, projected_source_count: counts("PROJECT"),
    quarantined_source_count: counts("QUARANTINE"), ignored_source_count: counts("IGNORE"),
    projected_row_count: rows.length, run_status: "COMPLETE"
  };
  return { plan, run, decisions, rows };
}

describe("WBS725 Gate 6 catalog projection to WBS742 importer parity", () => {
  it("binds all 45 targets, 241 fields, 47 synthetic rows and 23 definitions to the same semantic contracts", () => {
    assert.deepEqual(importFixture, { ...importFixture, directTargetCount: 45, targetColumnCount: 241, definitionTargetCount: 23, syntheticProjectionRowCount: 47 });
    assert.deepEqual([importContract.directTargetCount, importContract.targetColumnCount, importContract.definitionTargetCount], [45, 241, 23]);
    assert.equal(directTargets.length, 45);
    assert.equal(new Set(directTargets).size, 45);
    assert.equal(schema.columns.length, 241);
    assert.equal(new Set(schema.columns.map((column) => `${column.table}.${column.column}`)).size, 241);
    assert.deepEqual([...new Set(schema.columns.map((column) => column.table))].sort(), [...directTargets].sort());
    assert.equal(disposition.definitionSeed.length, 23);
    assert.deepEqual(componentSemanticSha256, importContract.componentSemanticSha256);
  });

  it("uses one canonical schema hash across LF/CRLF and losslessly feeds Catalog rows to the importer", () => {
    assert.equal(calculateCatalogTargetSchemaSha256(schemaText.replace(/\n/g, "\r\n")), targetSchemaSha256);
    assert.equal(fixture.targetSchemaSha256, importPolicy.targetSchemaSha256);
    const { plan, run, decisions, rows } = importerInput();
    const imported = buildObjectDomainImportPlan(run, decisions, rows, importPolicy);
    assert.equal(imported.rows.length, 1);
    assert.equal(imported.decisions.length, 3);
    assert.equal(imported.rows[0]!.target_payload_json, plan.decisions.find((decision) => decision.decisionStatus === "PROJECT")!.outputs[0]!.targetPayloadJson);
    assert.equal(imported.rows[0]!.target_payload_fingerprint, plan.decisions.find((decision) => decision.decisionStatus === "PROJECT")!.outputs[0]!.targetPayloadFingerprint);
    assert.equal(JSON.parse(imported.rows[0]!.target_payload_json).item_name, "다이아상자💎(/다이아상자오픈)");
  });

  it("fails closed before import when schema or semantic component bindings drift", () => {
    const { run, decisions, rows } = importerInput();
    assert.throws(() => buildObjectDomainImportPlan({ ...run, target_schema_sha256: "f".repeat(64) }, decisions, rows, importPolicy), /PROJECTION_RUN_INVALID/);
    const drifted = structuredClone(importPolicy);
    drifted.componentSemanticSha256.fieldMap = "f".repeat(64);
    assert.throws(() => buildObjectDomainImportPlan(run, decisions, rows, drifted), /COMPONENT_CONTRACT_DRIFT/);
  });
});
