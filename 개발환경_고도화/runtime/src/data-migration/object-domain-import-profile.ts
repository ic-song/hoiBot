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
