import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculateCatalogTargetSchemaSha256 } from "../src/data-migration/catalog-projection-provider.js";
import {
  assertObjectDomainImportPolicy,
  calculateObjectDomainImportComponentSemanticSha256,
  OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4,
  type DomainImportPolicy
} from "../src/data-migration/object-domain-importer.js";
import {
  applyObjectDomainImportProfileV2,
  applyObjectDomainImportProfileV4,
  calculateObjectDomainImportProfileV3Sha256,
  calculateObjectDomainImportProfileV4Sha256,
  parseObjectDomainImportProfileV2,
  parseObjectDomainImportProfileV3,
  parseObjectDomainImportProfileV4,
  parseObjectDomainImportTargetSchemaV4
} from "../src/data-migration/object-domain-import-profile.js";
import { loadGate3Documents, validateObjectDomainImportV4Gate3 } from "./validate-object-domain-import-v4-gate3.js";

const contracts = new URL("../../migration-control/contracts/", import.meta.url);
const text = (name: string): string => readFileSync(new URL(name, contracts), "utf8");
const json = <T>(name: string): T => JSON.parse(text(name)) as T;

export interface Gate4Validation {
  catalogVersion: string;
  deltaId: string;
  evidenceSchemaVersion: string;
  profileVersion: string;
  directTargetCount: number;
  targetColumnCount: number;
  definitionTargetCount: number;
  acceptedContractCount: number;
  targetColumnAdditionCount: number;
  databaseAccess: "NONE";
}

export function buildObjectDomainImportV4Gate4Policy(): DomainImportPolicy {
  const objectModelText = text("object-data-model-standard.v1.json");
  const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
  const disposition = json<{ definitionSeed: string[]; stateImport: string[]; derived: string[]; initialLedger: string[]; quarantineOnly: string[] }>("object-domain-import-disposition.v1.json");
  const schema = json<{ columns: DomainImportPolicy["columns"] }>("object-domain-import-target-schema.v1.json");
  const identity = json<{ generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] }>("object-domain-import-identity-bindings.v1.json");
  const fieldMap = json<{ mappings: Array<{ domain: string; targetTables: string[] }> }>("object-domain-import-field-map.v1.json");
  const v2 = parseObjectDomainImportProfileV2(text("object-domain-import-profile.v2.json"));
  const v3Text = text("object-domain-import-profile.v3.json");
  const v3 = parseObjectDomainImportProfileV3(v3Text);
  const v4Text = text("object-domain-import-profile.v4.json");
  const v4 = parseObjectDomainImportProfileV4(v4Text);
  const contract = json<{ componentSemanticSha256: DomainImportPolicy["contractComponentSemanticSha256"]; semanticHashPolicy: { currentImportContractProjectionSha256: string } }>("data-migration-object-domain-import.v4.json");
  const base = applyObjectDomainImportProfileV2({
    columns: schema.columns,
    generatedBindings: identity.generatedCuidBindings,
    foreignKeys: objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
    definitionTargets: disposition.definitionSeed,
    directTargets: [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly],
    domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables]))
  }, v2);
  const effective = applyObjectDomainImportProfileV4(base, parseObjectDomainImportTargetSchemaV4(text(v4.targetSchemaAmendment)));
  const effectiveIdentity = { ...identity, generatedCuidBindings: effective.generatedBindings };
  const effectiveDisposition = { ...disposition, definitionSeed: effective.definitionTargets, derived: disposition.derived.filter((table) => !effective.directTargets.includes(table)) };
  const effectiveFieldMap = { ...fieldMap, mappings: fieldMap.mappings.map((mapping) => ({ ...mapping, targetTables: effective.domainTargets[mapping.domain] })) };
  const componentSemanticSha256 = {
    identityBindings: calculateObjectDomainImportComponentSemanticSha256("identityBindings", JSON.stringify(effectiveIdentity), effective.directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4),
    objectModel: calculateObjectDomainImportComponentSemanticSha256("objectModel", objectModelText, effective.directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4),
    disposition: calculateObjectDomainImportComponentSemanticSha256("disposition", JSON.stringify(effectiveDisposition), effective.directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4),
    fieldMap: calculateObjectDomainImportComponentSemanticSha256("fieldMap", JSON.stringify(effectiveFieldMap), effective.directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4)
  };
  const exactDefinitionImports = v2.directTargetAdditions.map((target) => ({
    table: target.table,
    definitionTable: target.foreignKey.referencesTable,
    definitionPkColumn: target.foreignKey.referencesColumn,
    foreignKeyColumn: target.foreignKey.column,
    sourceSystem: target.exactSource.sourceSystem,
    sourceNamespace: target.exactSource.sourceNamespace,
    sourceIdentifier: target.exactSource.sourceIdentifier,
    sourceIdentifierOrigin: target.exactSource.sourceIdentifierOrigin
  }));
  const effectiveSchemaText = JSON.stringify({ catalogVersion: v4.catalogVersion, columns: effective.columns });
  return {
    catalogVersion: v4.catalogVersion,
    targetSchemaSha256: calculateCatalogTargetSchemaSha256(effectiveSchemaText),
    importContractSha256: contract.semanticHashPolicy.currentImportContractProjectionSha256,
    acceptedImportContractSha256: [contract.semanticHashPolicy.currentImportContractProjectionSha256],
    componentSemanticSha256,
    contractComponentSemanticSha256: contract.componentSemanticSha256,
    columns: effective.columns,
    generatedBindings: effective.generatedBindings,
    reusedBindings: identity.reusedPrimaryKeys,
    foreignKeys: effective.foreignKeys,
    directTargets: effective.directTargets,
    definitionTargets: effective.definitionTargets,
    domainTargets: effective.domainTargets,
    quarantineReasons: ["SOURCE_LOCATOR_PAYLOAD_DRIFT"],
    exactDefinitionImports,
    itemBagCompletenessV3: {
      profileVersion: v3.profileVersion,
      profileSemanticSha256: calculateObjectDomainImportProfileV3Sha256(v3Text),
      sourceNamespace: v3.completenessProjection.sourceNamespace,
      witnessRecordDomain: v3.completenessProjection.witnessRecordDomain,
      witnessRecordKind: v3.completenessProjection.witnessRecordKind,
      sourceKeyRecordKinds: v3.completenessProjection.sourceKeyRecordKinds
    },
    objectDomainImportV4: {
      profileVersion: v4.profileVersion,
      profileSemanticSha256: calculateObjectDomainImportProfileV4Sha256(v4Text),
      targetColumnAdditionCount: v4.targetColumnAdditionCount
    }
  };
}

export function validateObjectDomainImportV4Gate4(): Gate4Validation {
  const gate3 = validateObjectDomainImportV4Gate3(loadGate3Documents());
  const policy = buildObjectDomainImportV4Gate4Policy();
  assertObjectDomainImportPolicy(policy);
  if (policy.directTargets.length !== gate3.directTargetCount || policy.columns.length !== gate3.targetColumnCount || policy.definitionTargets.length !== gate3.definitionTargetCount) throw new Error("WBS742_GATE4_GATE3_CONTRACT_DRIFT");
  const cli = readFileSync(new URL("./import-object-domain.ts", import.meta.url), "utf8");
  for (const required of ["resolveObjectDomainImportProfileVersionV4", "applyObjectDomainImportProfileV4", "OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4"]) if (!cli.includes(required)) throw new Error(`WBS742_GATE4_CLI_V4_BINDING_MISSING:${required}`);
  return {
    catalogVersion: gate3.catalogVersion,
    deltaId: "SCD-WBS742-G4-20260909-1",
    evidenceSchemaVersion: "object-domain-import-gate4-evidence-v1",
    profileVersion: policy.objectDomainImportV4!.profileVersion,
    directTargetCount: policy.directTargets.length,
    targetColumnCount: policy.columns.length,
    definitionTargetCount: policy.definitionTargets.length,
    acceptedContractCount: policy.acceptedImportContractSha256.length,
    targetColumnAdditionCount: policy.objectDomainImportV4!.targetColumnAdditionCount,
    databaseAccess: "NONE"
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.stdout.write(`WBS742_GATE4_V4_PASS ${JSON.stringify(validateObjectDomainImportV4Gate4())}\n`);
