import { createHash } from "node:crypto";
import type { CatalogProjectionPolicy } from "./catalog-projection-provider.js";
import type { ObjectDomainImportProfileBase } from "./object-domain-import-profile.js";
import { EQUIPMENT_GRADE_NUMERIC_SOURCE_KEYS, EQUIPMENT_GRADE_SOURCE_KEYS } from "./equipment-grade-definition-adapter.js";

interface ExtensionSchemaColumn { table: string; column: string; sqlType: string; nullable: boolean }
interface ExtensionProfile {
  catalogVersion: "SC-20260902-1";
  format: "hoibot-object-domain-import-profile-equipment-grade-extension-v1";
  baseProfile: "data-migration-object-domain-import.v1.json";
  directTargetAdditions: string[];
  definitionTargetAdditions: string[];
  domainTargetAdditions: Record<string, string[]>;
  generatedCuidBindings: Array<{ targetTable: string; targetPkColumn: string; objectType: string; sourceNamespace: string }>;
  foreignKeys: Array<{ table: string; column: string; referencesTable: string; referencesColumn: string }>;
}
interface ExtensionSchema { format: string; tableCount: number; columnCount: number; columns: ExtensionSchemaColumn[] }
interface ExtensionObjectModel { registeredMigrations: string[]; tables: Array<{ table: string; primaryKey: string[]; foreignKeys?: ExtensionProfile["foreignKeys"] }> }
interface ExtensionFieldMap { format: string; expectedCoverage: { sourcePrimitiveKeyCount: number; unmapped: number; extra: number; duplicateMapping: number }; fields: Array<{ source: string; targetColumns: string[] }> }
interface ExtensionCatalog { format: string; sourcePrimitiveKeys: string[]; numericRuleBindings: Record<string, string>; numericRuleOrigin: string; coverage: { definitions: number; aliases: number; sourcePrimitiveKeys: number; unmapped: number; extra: number; duplicateMapping: number }; operationalDataAllowed: boolean }

export interface EquipmentGradeImportExtension {
  profile: ExtensionProfile;
  schema: ExtensionSchema;
  objectModel: ExtensionObjectModel;
  fieldMap: ExtensionFieldMap;
  catalog: ExtensionCatalog;
  semanticSha256: string;
}

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
};
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export function parseEquipmentGradeImportExtension(texts: { profile: string; schema: string; objectModel: string; fieldMap: string; catalog: string }): EquipmentGradeImportExtension {
  const profile = JSON.parse(texts.profile) as ExtensionProfile;
  const schema = JSON.parse(texts.schema) as ExtensionSchema;
  const objectModel = JSON.parse(texts.objectModel) as ExtensionObjectModel;
  const fieldMap = JSON.parse(texts.fieldMap) as ExtensionFieldMap;
  const catalog = JSON.parse(texts.catalog) as ExtensionCatalog;
  const targets = ["canonical_equipment_grade_definitions", "canonical_equipment_grade_aliases"];
  if (profile.catalogVersion !== "SC-20260902-1" || profile.format !== "hoibot-object-domain-import-profile-equipment-grade-extension-v1" || profile.baseProfile !== "data-migration-object-domain-import.v1.json") throw new Error("EQUIPMENT_GRADE_PROFILE_INVALID");
  if (stable(profile.directTargetAdditions) !== stable(targets) || stable(profile.definitionTargetAdditions) !== stable([targets[0]]) || stable(profile.domainTargetAdditions["pet-equipment"]) !== stable(targets)) throw new Error("EQUIPMENT_GRADE_PROFILE_TARGET_INVALID");
  if (schema.format !== "hoibot-object-domain-import-target-schema-equipment-grade-extension-v1" || schema.tableCount !== 2 || schema.columnCount !== 21 || schema.columns.length !== 21 || new Set(schema.columns.map((row) => `${row.table}.${row.column}`)).size !== 21) throw new Error("EQUIPMENT_GRADE_SCHEMA_INVALID");
  if (objectModel.registeredMigrations.length !== 1 || objectModel.registeredMigrations[0] !== "475_equipment_grade_definition_extension.sql" || stable(objectModel.tables.map((row) => row.table)) !== stable(targets)) throw new Error("EQUIPMENT_GRADE_OBJECT_MODEL_INVALID");
  const mappedKeys = fieldMap.fields.map((row) => row.source);
  if (fieldMap.format !== "hoibot-object-domain-import-field-map-equipment-grade-extension-v1" || stable([...mappedKeys].sort()) !== stable([...EQUIPMENT_GRADE_SOURCE_KEYS].sort()) || new Set(mappedKeys).size !== 13 || fieldMap.expectedCoverage.sourcePrimitiveKeyCount !== 13 || fieldMap.expectedCoverage.unmapped !== 0 || fieldMap.expectedCoverage.extra !== 0 || fieldMap.expectedCoverage.duplicateMapping !== 0) throw new Error("EQUIPMENT_GRADE_FIELD_MAP_COVERAGE_INVALID");
  if (catalog.format !== "hoibot-equipment-grade-catalog-projection-v1" || stable([...catalog.sourcePrimitiveKeys].sort()) !== stable([...EQUIPMENT_GRADE_SOURCE_KEYS].sort()) || catalog.coverage.definitions !== 106 || catalog.coverage.aliases !== 124 || catalog.coverage.sourcePrimitiveKeys !== 13 || catalog.coverage.unmapped !== 0 || catalog.coverage.extra !== 0 || catalog.coverage.duplicateMapping !== 0 || catalog.operationalDataAllowed !== false) throw new Error("EQUIPMENT_GRADE_CATALOG_CONTRACT_INVALID");
  if (stable(Object.keys(catalog.numericRuleBindings).sort()) !== stable([...EQUIPMENT_GRADE_NUMERIC_SOURCE_KEYS].sort()) || !catalog.numericRuleOrigin.includes("EXPLICIT_RULE") || !catalog.numericRuleOrigin.includes("fingerprint")) throw new Error("EQUIPMENT_GRADE_NUMERIC_RULE_BINDING_INVALID");
  if (profile.generatedCuidBindings.length !== 2 || profile.foreignKeys.length !== 1) throw new Error("EQUIPMENT_GRADE_IDENTITY_BINDING_INVALID");
  for (const target of targets) {
    const pk = objectModel.tables.find((row) => row.table === target)?.primaryKey[0];
    const binding = profile.generatedCuidBindings.find((row) => row.targetTable === target);
    const column = schema.columns.find((row) => row.table === target && row.column === pk);
    if (binding?.targetPkColumn !== pk || column?.sqlType !== "CHAR(8)" || column.nullable) throw new Error("EQUIPMENT_GRADE_IDENTITY_BINDING_INVALID");
  }
  const fk = profile.foreignKeys[0]!;
  const fkColumn = schema.columns.find((row) => row.table === fk.table && row.column === fk.column);
  const targetColumn = schema.columns.find((row) => row.table === fk.referencesTable && row.column === fk.referencesColumn);
  if (fk.column !== fk.referencesColumn || fkColumn?.sqlType !== targetColumn?.sqlType || fkColumn?.nullable !== false) throw new Error("EQUIPMENT_GRADE_FOREIGN_KEY_INVALID");
  return { profile, schema, objectModel, fieldMap, catalog, semanticSha256: sha256(stable({ profile, schema, objectModel, fieldMap, catalog })) };
}

export function applyEquipmentGradeImportExtension(base: ObjectDomainImportProfileBase, extension: EquipmentGradeImportExtension): ObjectDomainImportProfileBase {
  const p = extension.profile;
  if (p.directTargetAdditions.some((table) => base.directTargets.includes(table))) throw new Error("EQUIPMENT_GRADE_EXTENSION_ALREADY_APPLIED");
  return {
    columns: [...base.columns, ...extension.schema.columns],
    generatedBindings: [...base.generatedBindings, ...p.generatedCuidBindings],
    foreignKeys: [...base.foreignKeys, ...p.foreignKeys],
    definitionTargets: [...base.definitionTargets, ...p.definitionTargetAdditions],
    directTargets: [...base.directTargets, ...p.directTargetAdditions],
    domainTargets: { ...base.domainTargets, "pet-equipment": [...(base.domainTargets["pet-equipment"] ?? []), ...p.domainTargetAdditions["pet-equipment"]!] }
  };
}

export function applyEquipmentGradeCatalogProjectionExtension(base: CatalogProjectionPolicy, extension: EquipmentGradeImportExtension): CatalogProjectionPolicy {
  const effective = applyEquipmentGradeImportExtension({
    columns: base.columns, generatedBindings: base.generatedCuidBindings, foreignKeys: base.foreignKeys,
    definitionTargets: [], directTargets: Object.values(base.domainTargets).flat(), domainTargets: base.domainTargets
  }, extension);
  return { ...base, columns: effective.columns, generatedCuidBindings: effective.generatedBindings, foreignKeys: effective.foreignKeys, domainTargets: effective.domainTargets };
}
