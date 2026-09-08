import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyObjectDomainImportProfileV2,
  applyObjectDomainImportProfileV4,
  calculateObjectDomainImportProfileV4Sha256,
  parseObjectDomainImportProfileV2,
  parseObjectDomainImportProfileV4,
  parseObjectDomainImportTargetSchemaV4,
  resolveObjectDomainImportProfileVersionV4
} from "../src/data-migration/object-domain-import-profile.js";
import {
  calculateObjectDomainImportComponentSemanticSha256,
  calculateObjectDomainImportContractSemanticSha256,
  calculateObjectDomainImportSemanticSha256,
  OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4,
  type DomainImportPolicy
} from "../src/data-migration/object-domain-importer.js";

const contracts = new URL("../../migration-control/contracts/", import.meta.url);
const text = (name: string): string => readFileSync(new URL(name, contracts), "utf8");
const json = <T>(name: string): T => JSON.parse(text(name)) as T;

describe("WBS779 object-domain import V4 forward reseal", () => {
  const objectModel = json<{ registeredMigrations: string[]; tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> }>("object-data-model-standard.v1.json");
  const baseDisposition = json<{ definitionSeed: string[]; stateImport: string[]; derived: string[]; initialLedger: string[]; quarantineOnly: string[]; runtimeOnly: string[] }>("object-domain-import-disposition.v1.json");
  const disposition = json<{ registeredTableCount: number; baseClassifiedTableCount: number; additions: { derived: string[]; runtimeOnly: string[] }; operationalDataAllowed: boolean }>("object-domain-import-disposition.v4.json");
  const baseSchema = json<{ columns: DomainImportPolicy["columns"] }>("object-domain-import-target-schema.v1.json");
  const baseIdentity = json<{ generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] }>("object-domain-import-identity-bindings.v1.json");
  const baseFieldMap = json<{ mappings: Array<{ domain: string; targetTables: string[] }> }>("object-domain-import-field-map.v1.json");

  it("seals the exact current 39-migration list including 484 and 485", () => {
    assert.equal(objectModel.registeredMigrations.length, 39);
    assert.deepEqual(objectModel.registeredMigrations.slice(-6), [
      "484_pet_skill_info_shadow_ingress.sql",
      "485_pet_skill_info_admin_bag_projection.sql",
      "486_private_chat_denial_notice.sql",
      "488_item_bag_import_completeness.sql",
      "489_legacy_rank_label_side_effect_certificate.sql",
      "490_item_bag_import_baseline_ordering.sql"
    ]);
  });

  it("classifies every one of the 119 registered tables exactly once", () => {
    const categories = ["definitionSeed", "stateImport", "derived", "initialLedger", "quarantineOnly", "runtimeOnly"];
    const base = categories.flatMap((key) => baseDisposition[key as keyof typeof baseDisposition]);
    const additions = [...disposition.additions.derived, ...disposition.additions.runtimeOnly];
    const effective = [...base, ...additions];
    assert.deepEqual([base.length, additions.length, effective.length], [90, 29, 119]);
    assert.equal(new Set(effective).size, effective.length);
    assert.deepEqual(effective.slice().sort(), objectModel.tables.map((table) => table.table).sort());
    assert.equal(disposition.baseClassifiedTableCount, 90);
    assert.equal(disposition.registeredTableCount, 119);
    assert.equal(disposition.operationalDataAllowed, false);
  });

  it("adds all and only the eleven pet-skill definition columns from forward migrations", () => {
    const schema = parseObjectDomainImportTargetSchemaV4(text("object-domain-import-target-schema.v4.json"));
    const fieldMap = json<{ targetSchemaAmendment: string; targetTable: string; fields: Array<{ targetColumns: string[] }> }>("object-domain-import-field-map.v4.json");
    const schemaColumns = schema.columns.map((column) => `${column.table}.${column.column}`);
    const mappedColumns = fieldMap.fields.flatMap((field) => field.targetColumns);
    assert.deepEqual(mappedColumns, schemaColumns);
    assert.equal(new Set(mappedColumns).size, 11);
    assert.equal(fieldMap.targetSchemaAmendment, "object-domain-import-target-schema.v4.json");
    assert.equal(fieldMap.targetTable, "canonical_pet_skill_definitions");
    assert.deepEqual([...new Set(schema.columns.map((column) => column.migration))].sort(), ["481_canonical_pet_skill_read_provider.sql", "484_pet_skill_info_shadow_ingress.sql"]);
    assert.equal(schema.unicodeAmendmentMigration, "482_canonical_pet_skill_grade_unicode.sql");
    assert.equal(schema.adminProjectionMigration, "485_pet_skill_info_admin_bag_projection.sql");
    const sql481 = readFileSync(new URL("../migrations/481_canonical_pet_skill_read_provider.sql", import.meta.url), "utf8");
    const sql484 = readFileSync(new URL("../migrations/484_pet_skill_info_shadow_ingress.sql", import.meta.url), "utf8");
    for (const column of schema.columns) assert.match(column.migration === "481_canonical_pet_skill_read_provider.sql" ? sql481 : sql484, new RegExp(`(?:ADD COLUMN|SET[^;]*[,\\s])\\s*${column.column}\\b`, "s"), column.column);
  });

  it("selects V4 while preserving strict V1/V2/V3 profile routing", () => {
    assert.deepEqual([undefined, "v1", "v2", "v3", "v4"].map((version) => resolveObjectDomainImportProfileVersionV4(version)), ["v1", "v1", "v2", "v3", "v4"]);
    assert.throws(() => resolveObjectDomainImportProfileVersionV4("latest"), /PROFILE_UNKNOWN/);
    const profileText = text("object-domain-import-profile.v4.json");
    const profile = parseObjectDomainImportProfileV4(profileText);
    assert.equal(profile.registeredMigrationSeal[0], "484_pet_skill_info_shadow_ingress.sql");
    assert.match(profile.compatibility, /creating profiles/);
    assert.equal(calculateObjectDomainImportProfileV4Sha256(profileText).length, 64);
  });

  it("applies V4 additively without changing the frozen 47 direct targets", () => {
    const v2 = parseObjectDomainImportProfileV2(text("object-domain-import-profile.v2.json"));
    const base = applyObjectDomainImportProfileV2({
      columns: baseSchema.columns,
      generatedBindings: baseIdentity.generatedCuidBindings,
      foreignKeys: objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
      definitionTargets: baseDisposition.definitionSeed,
      directTargets: [...baseDisposition.definitionSeed, ...baseDisposition.stateImport, ...baseDisposition.initialLedger, ...baseDisposition.quarantineOnly],
      domainTargets: Object.fromEntries(baseFieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables]))
    }, v2);
    const effective = applyObjectDomainImportProfileV4(base, parseObjectDomainImportTargetSchemaV4(text("object-domain-import-target-schema.v4.json")));
    assert.deepEqual([base.directTargets.length, effective.directTargets.length, effective.columns.length - base.columns.length], [47, 47, 11]);
    assert.equal(new Set(effective.columns.map((column) => `${column.table}.${column.column}`)).size, effective.columns.length);
    assert.throws(() => applyObjectDomainImportProfileV4(effective, parseObjectDomainImportTargetSchemaV4(text("object-domain-import-target-schema.v4.json"))), /ALREADY_APPLIED_OR_BASE_INVALID/);
  });

  it("uses a distinct V4 semantic projection and rejects cross-profile compatibility", () => {
    const contract = json<{ amendmentSemanticSha256: Record<string, string>; componentSemanticSha256: Record<string, string>; semanticHashPolicy: { currentImportContractProjectionSha256: string; acceptedCompatibleImportContractSha256: string[] } }>("data-migration-object-domain-import.v4.json");
    assert.equal(contract.semanticHashPolicy.acceptedCompatibleImportContractSha256.length, 0);
    assert.equal(calculateObjectDomainImportContractSemanticSha256(text("data-migration-object-domain-import.v4.json")), contract.semanticHashPolicy.currentImportContractProjectionSha256);
    const directTargets = [...baseDisposition.definitionSeed, ...baseDisposition.stateImport, ...baseDisposition.initialLedger, ...baseDisposition.quarantineOnly, "canonical_item_definition_imports", "canonical_currency_definition_imports"];
    assert.equal(calculateObjectDomainImportComponentSemanticSha256("objectModel", text("object-data-model-standard.v1.json"), directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4), contract.componentSemanticSha256.objectModel);
    assert.deepEqual(contract.amendmentSemanticSha256, {
      disposition: calculateObjectDomainImportSemanticSha256(text("object-domain-import-disposition.v4.json")),
      targetSchema: calculateObjectDomainImportSemanticSha256(text("object-domain-import-target-schema.v4.json")),
      fieldMap: calculateObjectDomainImportSemanticSha256(text("object-domain-import-field-map.v4.json"))
    });
    const script = readFileSync(new URL("../scripts/import-object-domain.ts", import.meta.url), "utf8");
    assert.match(script, /resolveObjectDomainImportProfileVersionV4/);
    assert.match(script, /applyObjectDomainImportProfileV4/);
    assert.match(script, /profileVersion === "v4" \? OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4/);
    assert.match(script, /profileVersion === "v1" \? \[importContractSha256, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256\] : \[importContractSha256\]/);
  });
});
