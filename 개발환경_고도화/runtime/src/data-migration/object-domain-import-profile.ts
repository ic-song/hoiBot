import { createHash } from "node:crypto";
import type { DomainImportForeignKey, DomainImportGeneratedBinding, DomainImportSchemaColumn } from "./object-domain-importer.js";
import type { CatalogProjectionManifest, CatalogProjectionOutputDirective } from "./catalog-projection-provider.js";

export interface ObjectDomainImportProfileTarget {
  domain: string;
  table: string;
  primaryKey: string;
  objectType: string;
  sourceNamespace: string;
  columns: DomainImportSchemaColumn[];
  foreignKey: DomainImportForeignKey;
  exactSource: { sourceSystem: string; sourceNamespace: string; sourceIdentifier: string; sourceIdentifierOrigin: "SOURCE_EXACT" | "CONSTANT_CONTRACT"; sourceBindingPointer?: string };
  sourceProvenance: Record<string, unknown>;
}

export interface ObjectDomainImportProfileV2 {
  format: "hoibot-object-domain-import-profile-v2";
  profileVersion: "OBJECT_DOMAIN_IMPORT_RELEVANT_V2";
  catalogVersion: "SC-20260902-1";
  baseProfile: "data-migration-object-domain-import.v1.json";
  directTargetAdditions: ObjectDomainImportProfileTarget[];
  compatibility: string;
}

export interface ObjectDomainImportProfileV3 {
  format: "hoibot-object-domain-import-profile-v3";
  profileVersion: "OBJECT_DOMAIN_IMPORT_RELEVANT_V3";
  catalogVersion: "SC-20260902-1";
  baseProfile: "object-domain-import-profile.v2.json";
  schemaPlan: "item-bag-import-completeness-schema-plan.v1.json";
  witnessManifest: "item-bag-import-completeness-manifest.v1.json";
  completenessProjection: {
    table: "player_item_bag_import_completeness_projections";
    migration: "488_item_bag_import_completeness.sql";
    forwardCorrectionMigration: "490_item_bag_import_baseline_ordering.sql";
    sourceNamespace: "member.bag";
    witnessRecordDomain: "item";
    witnessRecordKind: "BAG_CONTAINER";
    witnessCatalogDecision: { status: "IGNORE"; reason: "NOT_OBJECT_DOMAIN_INPUT"; projectedRowCount: 0 };
    sourceKeyRecordKinds: ["ITEM_STACK"];
    playerBinding: string;
    zeroSourceRows: string;
    stateBinding: ["canonical_owned_item_stacks", "canonical_item_inventory_ledger_entries", "canonical_item_inventory_ledger_heads", "canonical_item_inventory_ledger_orderings", "player_item_bag_import_stack_baselines", "player_item_bag_import_ledger_baselines"];
    transactionBoundary: string;
  };
  compatibility: string;
}

export interface ObjectDomainImportProfileV4 {
  format: "hoibot-object-domain-import-profile-v4";
  profileVersion: "OBJECT_DOMAIN_IMPORT_RELEVANT_V4";
  catalogVersion: "SC-20260902-1";
  baseProfile: "object-domain-import-profile.v3.json";
  dispositionAmendment: "object-domain-import-disposition.v4.json";
  targetSchemaAmendment: "object-domain-import-target-schema.v4.json";
  fieldMapAmendment: "object-domain-import-field-map.v4.json";
  registeredMigrationSeal: ["484_pet_skill_info_shadow_ingress.sql", "485_pet_skill_info_admin_bag_projection.sql"];
  directTargetCount: 47;
  targetColumnAdditionCount: 11;
  compatibility: string;
}

export interface ObjectDomainImportTargetSchemaV4 {
  format: "hoibot-object-domain-import-target-schema-v4";
  baseSchema: "object-domain-import-target-schema.v1.json";
  table: "canonical_pet_skill_definitions";
  columnCount: 11;
  columns: Array<DomainImportSchemaColumn & { migration: string }>;
  unicodeAmendmentMigration: "482_canonical_pet_skill_grade_unicode.sql";
  adminProjectionMigration: "485_pet_skill_info_admin_bag_projection.sql";
}

export interface ObjectDomainImportProfileBase {
  columns: DomainImportSchemaColumn[];
  generatedBindings: DomainImportGeneratedBinding[];
  foreignKeys: DomainImportForeignKey[];
  definitionTargets: string[];
  directTargets: string[];
  domainTargets: Record<string, string[]>;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export function resolveObjectDomainImportProfileVersion(value: string | undefined): "v1" | "v2" {
  if (value === undefined || value === "v1") return "v1";
  if (value === "v2") return "v2";
  throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_UNKNOWN");
}

export function resolveObjectDomainImportProfileVersionV3(value: string | undefined): "v1" | "v2" | "v3" {
  if (value === "v3") return "v3";
  return resolveObjectDomainImportProfileVersion(value);
}

export function resolveObjectDomainImportProfileVersionV4(value: string | undefined): "v1" | "v2" | "v3" | "v4" {
  if (value === "v4") return "v4";
  return resolveObjectDomainImportProfileVersionV3(value);
}

export function parseObjectDomainImportProfileV4(text: string): ObjectDomainImportProfileV4 {
  const profile = JSON.parse(text) as ObjectDomainImportProfileV4;
  if (profile.format !== "hoibot-object-domain-import-profile-v4"
    || profile.profileVersion !== "OBJECT_DOMAIN_IMPORT_RELEVANT_V4"
    || profile.catalogVersion !== "SC-20260902-1"
    || profile.baseProfile !== "object-domain-import-profile.v3.json"
    || profile.dispositionAmendment !== "object-domain-import-disposition.v4.json"
    || profile.targetSchemaAmendment !== "object-domain-import-target-schema.v4.json"
    || profile.fieldMapAmendment !== "object-domain-import-field-map.v4.json"
    || profile.registeredMigrationSeal.length !== 2
    || profile.registeredMigrationSeal[0] !== "484_pet_skill_info_shadow_ingress.sql"
    || profile.registeredMigrationSeal[1] !== "485_pet_skill_info_admin_bag_projection.sql"
    || profile.directTargetCount !== 47
    || profile.targetColumnAdditionCount !== 11) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V4_INVALID");
  return profile;
}

export function parseObjectDomainImportTargetSchemaV4(text: string): ObjectDomainImportTargetSchemaV4 {
  const schema = JSON.parse(text) as ObjectDomainImportTargetSchemaV4;
  const expectedColumns = ["legacy_source_key", "display_order", "base_draw_rate", "fixed_draw_rate_flag", "openable_flag", "pet_skill_grade_emoji", "required_tier_name", "tier_exclusive_flag", "equip_description", "raid_charm_bonus", "castle_charm_bonus"];
  if (schema.format !== "hoibot-object-domain-import-target-schema-v4"
    || schema.baseSchema !== "object-domain-import-target-schema.v1.json"
    || schema.table !== "canonical_pet_skill_definitions"
    || schema.columnCount !== expectedColumns.length
    || schema.columns.length !== expectedColumns.length
    || schema.unicodeAmendmentMigration !== "482_canonical_pet_skill_grade_unicode.sql"
    || schema.adminProjectionMigration !== "485_pet_skill_info_admin_bag_projection.sql") throw new Error("OBJECT_DOMAIN_IMPORT_TARGET_SCHEMA_V4_INVALID");
  for (const [index, column] of schema.columns.entries()) {
    const expectedMigration = index < 9 ? "481_canonical_pet_skill_read_provider.sql" : "484_pet_skill_info_shadow_ingress.sql";
    if (column.table !== schema.table || column.column !== expectedColumns[index] || column.migration !== expectedMigration) throw new Error("OBJECT_DOMAIN_IMPORT_TARGET_SCHEMA_V4_INVALID");
  }
  return schema;
}

export function calculateObjectDomainImportProfileV4Sha256(text: string): string {
  return sha256(JSON.stringify(parseObjectDomainImportProfileV4(text)));
}

export function applyObjectDomainImportProfileV4(base: ObjectDomainImportProfileBase, schema: ObjectDomainImportTargetSchemaV4): ObjectDomainImportProfileBase {
  const additions = schema.columns;
  if (base.directTargets.length !== 47 || !base.directTargets.includes(schema.table) || additions.some((addition) => base.columns.some((column) => column.table === addition.table && column.column === addition.column))) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V4_ALREADY_APPLIED_OR_BASE_INVALID");
  return { ...base, columns: [...base.columns, ...additions] };
}

export function parseObjectDomainImportProfileV3(text: string): ObjectDomainImportProfileV3 {
  const profile = JSON.parse(text) as ObjectDomainImportProfileV3;
  const projection = profile.completenessProjection;
  if (profile.format !== "hoibot-object-domain-import-profile-v3"
    || profile.profileVersion !== "OBJECT_DOMAIN_IMPORT_RELEVANT_V3"
    || profile.catalogVersion !== "SC-20260902-1"
    || profile.baseProfile !== "object-domain-import-profile.v2.json"
    || profile.schemaPlan !== "item-bag-import-completeness-schema-plan.v1.json"
    || profile.witnessManifest !== "item-bag-import-completeness-manifest.v1.json"
    || projection?.table !== "player_item_bag_import_completeness_projections"
    || projection.migration !== "488_item_bag_import_completeness.sql"
    || projection.forwardCorrectionMigration !== "490_item_bag_import_baseline_ordering.sql"
    || projection.sourceNamespace !== "member.bag"
    || projection.witnessRecordDomain !== "item"
    || projection.witnessRecordKind !== "BAG_CONTAINER"
    || projection.witnessCatalogDecision?.status !== "IGNORE"
    || projection.witnessCatalogDecision.reason !== "NOT_OBJECT_DOMAIN_INPUT"
    || projection.witnessCatalogDecision.projectedRowCount !== 0
    || projection.sourceKeyRecordKinds.length !== 1
    || projection.sourceKeyRecordKinds[0] !== "ITEM_STACK"
    || projection.stateBinding.length !== 6
    || projection.stateBinding[0] !== "canonical_owned_item_stacks"
    || projection.stateBinding[1] !== "canonical_item_inventory_ledger_entries"
    || projection.stateBinding[2] !== "canonical_item_inventory_ledger_heads"
    || projection.stateBinding[3] !== "canonical_item_inventory_ledger_orderings"
    || projection.stateBinding[4] !== "player_item_bag_import_stack_baselines"
    || projection.stateBinding[5] !== "player_item_bag_import_ledger_baselines") throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V3_INVALID");
  return profile;
}

export function calculateObjectDomainImportProfileV3Sha256(text: string): string {
  const profile = parseObjectDomainImportProfileV3(text);
  return sha256(JSON.stringify(profile));
}

export function parseObjectDomainImportProfileV2(text: string): ObjectDomainImportProfileV2 {
  const profile = JSON.parse(text) as ObjectDomainImportProfileV2;
  if (profile.format !== "hoibot-object-domain-import-profile-v2" || profile.profileVersion !== "OBJECT_DOMAIN_IMPORT_RELEVANT_V2" || profile.catalogVersion !== "SC-20260902-1" || profile.baseProfile !== "data-migration-object-domain-import.v1.json") throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_INVALID");
  if (profile.directTargetAdditions.length !== 2) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_TARGET_COUNT_INVALID");
  const expected = new Map<string, readonly string[]>([
    ["canonical_item_definition_imports", ["item", "item_definition_import_id", "canonical_item_definitions", "item_id", "member.bag", "펫타이틀권🦊(/펫타이틀이름)", "SOURCE_EXACT", ""]],
    ["canonical_currency_definition_imports", ["currency", "currency_definition_import_id", "canonical_currency_definitions", "currency_id", "member.point", "point", "CONSTANT_CONTRACT", "ABSENT"]]
  ]);
  const seen = new Set<string>();
  for (const target of profile.directTargetAdditions) {
    const rule = expected.get(target.table);
    if (rule === undefined || seen.has(target.table) || target.domain !== rule[0] || target.primaryKey !== rule[1] || target.foreignKey.referencesTable !== rule[2] || target.foreignKey.referencesColumn !== rule[3] || target.exactSource.sourceSystem !== "LEGACY_JSON" || target.exactSource.sourceNamespace !== rule[4] || target.exactSource.sourceIdentifier !== rule[5] || target.exactSource.sourceIdentifierOrigin !== rule[6] || (rule[7] === "ABSENT" ? target.exactSource.sourceBindingPointer !== undefined : target.exactSource.sourceBindingPointer !== rule[7])) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_EXACT_SOURCE_INVALID");
    seen.add(target.table);
    if (target.foreignKey.table !== target.table || !target.columns.some((column) => column.table === target.table && column.column === target.primaryKey && column.sqlType === "CHAR(8)" && !column.nullable)) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_SCHEMA_INVALID");
    const provenance = target.sourceProvenance;
    if (provenance === null || typeof provenance !== "object") throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_PROVENANCE_INVALID");
    const itemProvenanceValid = target.table !== "canonical_item_definition_imports" || (provenance.logicalSource === "data/itemList.json" && provenance.jsonPointer === "/nonItems/16" && provenance.sourceOrder === 17 && provenance.definitionSha256 === "01c34af9927b5637819a05c99fe39e39186c6d6b3552e95e72a9f7c6150c7743" && provenance.sourceRowSha256 === "35a45eda88719f0a7a791b9db0bb66c452b13b0dd787a714055e4b0e9efa970b" && provenance.sealedFileSha256 === "b6f4751f2faf7588c2e41c032bac4fc5b05ff6bd2c105ea0c57a0e072c60c402");
    const pointProvenanceValid = target.table !== "canonical_currency_definition_imports" || (provenance.logicalSource === "data/member.json" && provenance.jsonPointer === "/member/{playerKey}/point" && provenance.definitionRule === "object-domain-import-field-map.v1.json#currency-fixed-point-catalog");
    if (!itemProvenanceValid || !pointProvenanceValid) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_PROVENANCE_INVALID");
  }
  return profile;
}

function manifestIdentityLocator(sourceLocator: string, outputs: CatalogProjectionOutputDirective[], output: CatalogProjectionOutputDirective): string {
  return outputs.length === 1 ? sourceLocator : sha256(`${sourceLocator}\0${output.projectionLocator}\0${output.targetTable}`);
}

export function assertObjectDomainImportV2ProjectionManifest(manifest: CatalogProjectionManifest, profile: ObjectDomainImportProfileV2): void {
  const allOutputs = manifest.sources.flatMap((source) => source.outputs.map((output) => ({ source, output, locator: manifestIdentityLocator(source.sourceLocatorSha256, source.outputs, output) })));
  for (const target of profile.directTargetAdditions) {
    const matches = allOutputs.filter(({ output }) => output.targetTable === target.table);
    if (matches.length !== 1) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_EXACT_ROW_COUNT_INVALID");
    const { output } = matches[0]!;
    const exact = target.exactSource;
    if (output.payload.source_system !== exact.sourceSystem || output.payload.source_namespace !== exact.sourceNamespace || output.payload.source_identifier !== exact.sourceIdentifier || output.valueOrigins.source_system !== "CONSTANT_CONTRACT" || output.valueOrigins.source_namespace !== "CONSTANT_CONTRACT" || output.valueOrigins.source_identifier !== exact.sourceIdentifierOrigin) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_EXACT_TUPLE_INVALID");
    if (exact.sourceIdentifierOrigin === "SOURCE_EXACT") {
      if (output.sourceBindings.source_identifier !== exact.sourceBindingPointer) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_SOURCE_BINDING_INVALID");
    } else if ("source_identifier" in output.sourceBindings) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_SOURCE_BINDING_INVALID");
    const references = output.referenceBindings.filter((reference) => reference.column === target.foreignKey.column);
    if (output.referenceBindings.length !== 1 || references.length !== 1 || references[0]!.bindingScope !== "MANIFEST" || references[0]!.targetTable !== target.foreignKey.referencesTable || references[0]!.targetPkColumn !== target.foreignKey.referencesColumn || references[0]!.approvalSha256 !== undefined) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_DEFINITION_FK_INVALID");
    const definition = allOutputs.filter(({ output: candidate, locator }) => candidate.targetTable === target.foreignKey.referencesTable && candidate.targetPkColumn === target.foreignKey.referencesColumn && locator === references[0]!.identityLocatorSha256);
    if (definition.length !== 1) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_DEFINITION_FK_UNRESOLVED");
  }
}

export function calculateObjectDomainImportProfileV2Sha256(text: string): string {
  const profile = parseObjectDomainImportProfileV2(text);
  return sha256(JSON.stringify(profile));
}

export function applyObjectDomainImportProfileV2(base: ObjectDomainImportProfileBase, profile: ObjectDomainImportProfileV2): ObjectDomainImportProfileBase {
  const additions = profile.directTargetAdditions;
  for (const target of additions) if (base.directTargets.includes(target.table) || base.columns.some((column) => column.table === target.table)) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_ALREADY_APPLIED");
  return {
    columns: [...base.columns, ...additions.flatMap((target) => target.columns)],
    generatedBindings: [...base.generatedBindings, ...additions.map((target) => ({ targetTable: target.table, targetPkColumn: target.primaryKey, objectType: target.objectType, sourceNamespace: target.sourceNamespace }))],
    foreignKeys: [...base.foreignKeys, ...additions.map((target) => target.foreignKey).filter((addition) => !base.foreignKeys.some((foreignKey) => foreignKey.table === addition.table && foreignKey.column === addition.column && foreignKey.referencesTable === addition.referencesTable && foreignKey.referencesColumn === addition.referencesColumn))],
    definitionTargets: [...base.definitionTargets, ...additions.map((target) => target.table)],
    directTargets: [...base.directTargets, ...additions.map((target) => target.table)],
    domainTargets: Object.fromEntries(Object.entries(base.domainTargets).map(([domain, targets]) => [domain, [...targets, ...additions.filter((target) => target.domain === domain).map((target) => target.table)]]))
  };
}
