import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildCatalogProjectionPlan, calculateCatalogTargetSchemaSha256, type CatalogProjectionManifest, type CatalogProjectionOutputDirective, type CatalogProjectionPolicy } from "../src/data-migration/catalog-projection-provider.js";
import { assertObjectDomainImportExactDefinitionRows, assertObjectDomainImportPolicy, calculateObjectDomainImportComponentSemanticSha256, calculateObjectDomainImportContractSemanticSha256, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V2, type DomainImportExactDefinitionImport, type DomainImportPolicy } from "../src/data-migration/object-domain-importer.js";
import { applyObjectDomainImportProfileV2, assertObjectDomainImportV2ProjectionManifest, calculateObjectDomainImportProfileV2Sha256, parseObjectDomainImportProfileV2, resolveObjectDomainImportProfileVersion } from "../src/data-migration/object-domain-import-profile.js";

const contractRoot = new URL("../../migration-control/contracts/", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("object-domain-import-target-schema.v1.json", contractRoot), "utf8"));
const identity = JSON.parse(readFileSync(new URL("object-domain-import-identity-bindings.v1.json", contractRoot), "utf8"));
const objectModel = JSON.parse(readFileSync(new URL("object-data-model-standard.v1.json", contractRoot), "utf8"));
const disposition = JSON.parse(readFileSync(new URL("object-domain-import-disposition.v1.json", contractRoot), "utf8"));
const fieldMap = JSON.parse(readFileSync(new URL("object-domain-import-field-map.v1.json", contractRoot), "utf8"));
const profileText = readFileSync(new URL("object-domain-import-profile.v2.json", contractRoot), "utf8");
const profile = parseObjectDomainImportProfileV2(profileText);
const v1DirectTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
const effective = applyObjectDomainImportProfileV2({
  columns: schema.columns,
  generatedBindings: identity.generatedCuidBindings,
  foreignKeys: objectModel.tables.flatMap((table: any) => (table.foreignKeys ?? []).filter((foreignKey: any) => "column" in foreignKey).map((foreignKey: any) => ({ table: table.table, ...foreignKey }))),
  definitionTargets: disposition.definitionSeed,
  directTargets: v1DirectTargets,
  domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping: any) => [mapping.domain, mapping.targetTables]))
}, profile);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function sample(sqlType: string, nullable: boolean): unknown {
  if (nullable) return null;
  if (sqlType === "BOOLEAN") return true;
  if (/^(?:TINYINT|INT|BIGINT)(?: UNSIGNED)?$/.test(sqlType) || /^DECIMAL/.test(sqlType)) return "0";
  if (sqlType === "JSON") return {};
  return "정의";
}

function definitionOutput(table: string, pk: string, sourceLocator: string): CatalogProjectionOutputDirective {
  const binding = effective.generatedBindings.find((candidate) => candidate.targetTable === table)!;
  const payload: Record<string, unknown> = {};
  const valueOrigins: Record<string, "SOURCE_ABSENT" | "CONSTANT_CONTRACT"> = {};
  const sourceBindings: Record<string, string> = {};
  for (const column of effective.columns.filter((candidate) => candidate.table === table && candidate.column !== pk)) {
    payload[column.column] = sample(column.sqlType, column.nullable);
    valueOrigins[column.column] = column.nullable ? "SOURCE_ABSENT" : "CONSTANT_CONTRACT";
    if (column.nullable) sourceBindings[column.column] = `/absent/${column.column}`;
  }
  return { projectionLocator: "definition", identityMode: "GENERATED", targetTable: table, targetPkColumn: pk, targetObjectType: binding.objectType, targetSourceNamespace: binding.sourceNamespace, payload, valueOrigins, sourceBindings, referenceBindings: [] };
}

function source(target: typeof profile.directTargetAdditions[number], definitionTable: string, definitionPk: string, sourceIndex: number) {
  const sourceLocator = hash(`v2-source-${sourceIndex}`);
  const definition = definitionOutput(definitionTable, definitionPk, sourceLocator);
  const definitionLocator = hash(`${sourceLocator}\0definition\0${definitionTable}`);
  const payload: Record<string, unknown> = { source_system: target.exactSource.sourceSystem, source_namespace: target.exactSource.sourceNamespace, source_identifier: target.exactSource.sourceIdentifier };
  const valueOrigins: Record<string, "SOURCE_EXACT" | "CONSTANT_CONTRACT"> = { source_system: "CONSTANT_CONTRACT", source_namespace: "CONSTANT_CONTRACT", source_identifier: target.exactSource.sourceIdentifierOrigin };
  if (target.table === "canonical_currency_definition_imports") { payload.payload_fingerprint = hash("point-definition"); valueOrigins.payload_fingerprint = "CONSTANT_CONTRACT"; }
  const imported: CatalogProjectionOutputDirective = {
    projectionLocator: "exact-import",
    identityMode: "GENERATED",
    targetTable: target.table,
    targetPkColumn: target.primaryKey,
    targetObjectType: target.objectType,
    targetSourceNamespace: target.sourceNamespace,
    payload,
    valueOrigins,
    sourceBindings: target.exactSource.sourceIdentifierOrigin === "SOURCE_EXACT" ? { source_identifier: target.exactSource.sourceBindingPointer! } : {},
    referenceBindings: [{ column: target.foreignKey.column, targetTable: definitionTable, targetPkColumn: definitionPk, identityLocatorSha256: definitionLocator, bindingScope: "MANIFEST" }]
  };
  return { sourceLocatorSha256: sourceLocator, sourcePayloadFingerprint: hash(JSON.stringify(target.exactSource.sourceIdentifier)), recordDomain: target.domain, decisionStatus: "PROJECT" as const, outputs: [definition, imported] };
}

describe("WBS742 object domain import V2 profile", () => {
  it("keeps V1 immutable and adds exactly two provenance targets", () => {
    assert.equal(resolveObjectDomainImportProfileVersion(undefined), "v1");
    assert.equal(resolveObjectDomainImportProfileVersion("v2"), "v2");
    assert.throws(() => resolveObjectDomainImportProfileVersion("v3"), /OBJECT_DOMAIN_IMPORT_PROFILE_UNKNOWN/);
    assert.equal(v1DirectTargets.length, 45);
    assert.equal(schema.columns.length, 241);
    assert.deepEqual(v1DirectTargets.filter((table: string) => table.endsWith("definition_imports")), []);
    assert.equal(effective.directTargets.length, 47);
    assert.equal(effective.columns.length, 252);
    assert.equal(effective.definitionTargets.length, 25);
    assert.deepEqual(effective.directTargets.slice(-2), ["canonical_item_definition_imports", "canonical_currency_definition_imports"]);
  });

  it("pins the ticket and point exact tuples without display-name lookup fallback", () => {
    assert.deepEqual(profile.directTargetAdditions.map((target) => [target.exactSource.sourceSystem, target.exactSource.sourceNamespace, target.exactSource.sourceIdentifier]), [["LEGACY_JSON", "member.bag", "펫타이틀권🦊(/펫타이틀이름)"], ["LEGACY_JSON", "member.point", "point"]]);
    assert.equal(profile.directTargetAdditions[1]!.exactSource.sourceIdentifierOrigin, "CONSTANT_CONTRACT");
    assert.equal(calculateObjectDomainImportProfileV2Sha256(profileText), "706f125de067f40f186cae9691410aa254e8dfcb3a33c2d225c49d40f683a58f");
  });

  it("projects each provenance row with a MANIFEST FK to its definition", () => {
    const schemaText = JSON.stringify({ catalogVersion: "SC-20260902-1", columns: effective.columns });
    const policy: CatalogProjectionPolicy = { targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaText), columns: effective.columns, generatedCuidBindings: effective.generatedBindings, reusedPrimaryKeys: identity.reusedPrimaryKeys, foreignKeys: effective.foreignKeys, domainTargets: effective.domainTargets, quarantineReasons: fieldMap.recordQuarantine };
    const sources = [source(profile.directTargetAdditions[0]!, "canonical_item_definitions", "item_id", 1), source(profile.directTargetAdditions[1]!, "canonical_currency_definitions", "currency_id", 2)];
    assert.equal(sources[0]!.outputs.find((output) => output.targetTable.endsWith("definition_imports"))!.sourceBindings.source_identifier, "");
    assert.equal(sources[1]!.outputs.find((output) => output.targetTable.endsWith("definition_imports"))!.sourceBindings.source_identifier, undefined);
    const manifest: CatalogProjectionManifest = { format: "hoibot-catalog-projection-manifest-v1", catalogVersion: "SC-20260902-1", commonStagingRunId: "s1234567", commonStagingSha256: hash("staging"), commonStagingEnvelope: { rawBundleSha256: hash("raw"), snapshotManifestSha256: hash("snapshot"), extractionManifestSha256: hash("extract"), expectedFileCount: 2, expectedTotalBytes: "100", projectedFileCount: 2, ignoredFileCount: 0 }, targetSchemaSha256: policy.targetSchemaSha256, actor: "wbs742-v2-test", sources };
    const plan = buildCatalogProjectionPlan(manifest, policy);
    assert.doesNotThrow(() => assertObjectDomainImportV2ProjectionManifest(manifest, profile));
    const imports = plan.decisions.flatMap((decision) => decision.outputs).filter((output) => output.targetTable.endsWith("definition_imports"));
    assert.equal(imports.length, 2);
    assert.ok(imports.every((output) => JSON.parse(output.referenceBindingsJson)[0].bindingScope === "MANIFEST"));
    assert.deepEqual(imports.map((output) => JSON.parse(output.targetPayloadJson)).map(({ source_system, source_namespace, source_identifier }) => ({ source_system, source_namespace, source_identifier })), [
      { source_system: "LEGACY_JSON", source_namespace: "member.bag", source_identifier: "펫타이틀권🦊(/펫타이틀이름)" },
      { source_system: "LEGACY_JSON", source_namespace: "member.point", source_identifier: "point" }
    ]);
    const importRows = plan.decisions.flatMap((decision) => decision.outputs).map((output) => ({ target_table_name: output.targetTable, target_pk_column_name: output.targetPkColumn, identity_locator_sha256: output.identityLocatorSha256, payload: JSON.parse(output.targetPayloadJson), valueOrigins: JSON.parse(output.valueOriginsJson), references: JSON.parse(output.referenceBindingsJson) }));
    const exactImports: DomainImportExactDefinitionImport[] = profile.directTargetAdditions.map((target) => ({ table: target.table, definitionTable: target.foreignKey.referencesTable, definitionPkColumn: target.foreignKey.referencesColumn, foreignKeyColumn: target.foreignKey.column, sourceSystem: target.exactSource.sourceSystem, sourceNamespace: target.exactSource.sourceNamespace, sourceIdentifier: target.exactSource.sourceIdentifier, sourceIdentifierOrigin: target.exactSource.sourceIdentifierOrigin }));
    assert.doesNotThrow(() => assertObjectDomainImportExactDefinitionRows(importRows, exactImports));
    const importerTupleDrift = structuredClone(importRows); importerTupleDrift.find((row) => row.target_table_name === "canonical_currency_definition_imports")!.valueOrigins.source_identifier = "SOURCE_EXACT";
    assert.throws(() => assertObjectDomainImportExactDefinitionRows(importerTupleDrift, exactImports), /TUPLE_INVALID/);
    const importerFkDrift = structuredClone(importRows); importerFkDrift.find((row) => row.target_table_name === "canonical_item_definition_imports")!.references[0].identityLocatorSha256 = hash("missing-definition");
    assert.throws(() => assertObjectDomainImportExactDefinitionRows(importerFkDrift, exactImports), /FK_UNRESOLVED/);
  });

  it("fails closed on duplicate/missing rows, tuple drift, FK drift, point origin drift and provenance drift", () => {
    const schemaText = JSON.stringify({ catalogVersion: "SC-20260902-1", columns: effective.columns });
    const baseManifest: CatalogProjectionManifest = { format: "hoibot-catalog-projection-manifest-v1", catalogVersion: "SC-20260902-1", commonStagingRunId: "s1234567", commonStagingSha256: hash("staging"), commonStagingEnvelope: { rawBundleSha256: hash("raw"), snapshotManifestSha256: hash("snapshot"), extractionManifestSha256: hash("extract"), expectedFileCount: 2, expectedTotalBytes: "100", projectedFileCount: 2, ignoredFileCount: 0 }, targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaText), actor: "wbs742-v2-negative", sources: [source(profile.directTargetAdditions[0]!, "canonical_item_definitions", "item_id", 1), source(profile.directTargetAdditions[1]!, "canonical_currency_definitions", "currency_id", 2)] };
    const clone = (): CatalogProjectionManifest => structuredClone(baseManifest);
    const missing = clone(); missing.sources[0]!.outputs = missing.sources[0]!.outputs.filter((output) => output.targetTable !== "canonical_item_definition_imports");
    assert.throws(() => assertObjectDomainImportV2ProjectionManifest(missing, profile), /EXACT_ROW_COUNT_INVALID/);
    const duplicate = clone(); duplicate.sources[0]!.outputs.push(structuredClone(duplicate.sources[0]!.outputs.find((output) => output.targetTable === "canonical_item_definition_imports")!));
    assert.throws(() => assertObjectDomainImportV2ProjectionManifest(duplicate, profile), /EXACT_ROW_COUNT_INVALID/);
    const tuple = clone(); tuple.sources[1]!.outputs.find((output) => output.targetTable === "canonical_currency_definition_imports")!.payload.source_namespace = "memberCurrency";
    assert.throws(() => assertObjectDomainImportV2ProjectionManifest(tuple, profile), /EXACT_TUPLE_INVALID/);
    const origin = clone(); origin.sources[1]!.outputs.find((output) => output.targetTable === "canonical_currency_definition_imports")!.valueOrigins.source_identifier = "SOURCE_EXACT";
    assert.throws(() => assertObjectDomainImportV2ProjectionManifest(origin, profile), /EXACT_TUPLE_INVALID/);
    const fk = clone(); fk.sources[0]!.outputs.find((output) => output.targetTable === "canonical_item_definition_imports")!.referenceBindings[0]!.bindingScope = "APPROVED_CROSSWALK";
    assert.throws(() => assertObjectDomainImportV2ProjectionManifest(fk, profile), /DEFINITION_FK_INVALID/);
    const profileDrift = JSON.parse(profileText); profileDrift.directTargetAdditions[0].sourceProvenance.sourceRowSha256 = "0".repeat(64);
    assert.throws(() => parseObjectDomainImportProfileV2(JSON.stringify(profileDrift)), /PROVENANCE_INVALID/);
  });

  it("validates the isolated V2 semantic contract", () => {
    const contractText = readFileSync(new URL("data-migration-object-domain-import.v2.json", contractRoot), "utf8");
    const contract = JSON.parse(contractText);
    const componentTexts = {
      identityBindings: JSON.stringify({ ...identity, generatedCuidBindings: effective.generatedBindings }),
      objectModel: JSON.stringify(objectModel),
      disposition: JSON.stringify({ ...disposition, definitionSeed: effective.definitionTargets, derived: disposition.derived.filter((table: string) => !effective.directTargets.includes(table)) }),
      fieldMap: JSON.stringify({ ...fieldMap, mappings: fieldMap.mappings.map((mapping: any) => ({ ...mapping, targetTables: effective.domainTargets[mapping.domain] })) })
    };
    for (const [component, text] of Object.entries(componentTexts)) assert.equal(calculateObjectDomainImportComponentSemanticSha256(component as keyof typeof componentTexts, text, effective.directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V2), contract.componentSemanticSha256[component]);
    const importContractSha256 = calculateObjectDomainImportContractSemanticSha256(contractText);
    assert.equal(importContractSha256, "f8f38912729ea5f8368387f0661b41d748eb5d5f93f477fbb6d6f053d0f82a98");
    const policy: DomainImportPolicy = { catalogVersion: "SC-20260902-1", targetSchemaSha256: calculateCatalogTargetSchemaSha256(JSON.stringify({ catalogVersion: "SC-20260902-1", columns: effective.columns })), importContractSha256, acceptedImportContractSha256: [importContractSha256], componentSemanticSha256: contract.componentSemanticSha256, contractComponentSemanticSha256: contract.componentSemanticSha256, columns: effective.columns, generatedBindings: effective.generatedBindings, reusedBindings: identity.reusedPrimaryKeys, foreignKeys: effective.foreignKeys, directTargets: effective.directTargets, definitionTargets: effective.definitionTargets, domainTargets: effective.domainTargets, quarantineReasons: fieldMap.recordQuarantine, exactDefinitionImports: profile.directTargetAdditions.map((target) => ({ table: target.table, definitionTable: target.foreignKey.referencesTable, definitionPkColumn: target.foreignKey.referencesColumn, foreignKeyColumn: target.foreignKey.column, sourceSystem: target.exactSource.sourceSystem, sourceNamespace: target.exactSource.sourceNamespace, sourceIdentifier: target.exactSource.sourceIdentifier, sourceIdentifierOrigin: target.exactSource.sourceIdentifierOrigin })) };
    assert.doesNotThrow(() => assertObjectDomainImportPolicy(policy));
    assert.throws(() => assertObjectDomainImportPolicy({ ...policy, exactDefinitionImports: policy.exactDefinitionImports!.slice(0, 1) }), /COMPATIBLE_CONTRACT_POLICY_INVALID/);
    const policyDrift = structuredClone(policy); policyDrift.exactDefinitionImports![1]!.sourceIdentifierOrigin = "SOURCE_EXACT";
    assert.throws(() => assertObjectDomainImportPolicy(policyDrift), /EXACT_DEFINITION_IMPORT_POLICY_INVALID/);
  });
});
