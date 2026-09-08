import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { assertObjectDomainImportDatabaseName, calculateObjectDomainImportComponentSemanticSha256, calculateObjectDomainImportContractSemanticSha256, calculateObjectDomainImportSemanticSha256, MariaObjectDomainImporter, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V2, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V3, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4, type DomainImportExactDefinitionImport, type DomainImportPolicy } from "../src/data-migration/object-domain-importer.js";
import { applyObjectDomainImportProfileV2, applyObjectDomainImportProfileV4, calculateObjectDomainImportProfileV2Sha256, calculateObjectDomainImportProfileV3Sha256, calculateObjectDomainImportProfileV4Sha256, parseObjectDomainImportProfileV2, parseObjectDomainImportProfileV3, parseObjectDomainImportProfileV4, parseObjectDomainImportTargetSchemaV4, resolveObjectDomainImportProfileVersionV4 } from "../src/data-migration/object-domain-import-profile.js";
import { calculateCatalogTargetSchemaSha256 } from "../src/data-migration/catalog-projection-provider.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const catalogProjectionRunId = argument("--catalog-projection-run");
if (catalogProjectionRunId === undefined) throw new Error("USAGE: --catalog-projection-run <CUID2> [--profile v1|v2|v3|v4] [--rollback] [--target-schema <json>] [--identity-bindings <json>] [--object-model <json>] [--disposition <json>] [--field-map <json>] [--contract <json>]");
const profileVersion = resolveObjectDomainImportProfileVersionV4(argument("--profile"));
const schemaPath = argument("--target-schema") ?? resolve("../migration-control/contracts/object-domain-import-target-schema.v1.json");
const identityPath = argument("--identity-bindings") ?? resolve("../migration-control/contracts/object-domain-import-identity-bindings.v1.json");
const objectModelPath = argument("--object-model") ?? resolve("../migration-control/contracts/object-data-model-standard.v1.json");
const dispositionPath = argument("--disposition") ?? resolve("../migration-control/contracts/object-domain-import-disposition.v1.json");
const fieldMapPath = argument("--field-map") ?? resolve("../migration-control/contracts/object-domain-import-field-map.v1.json");
const contractPath = argument("--contract") ?? resolve(`../migration-control/contracts/data-migration-object-domain-import.${profileVersion}.json`);
const [schemaBytes, identityText, objectModelText, dispositionText, fieldMapText, contractBytes] = await Promise.all([
  readFile(schemaPath), readFile(identityPath, "utf8"), readFile(objectModelPath, "utf8"), readFile(dispositionPath, "utf8"), readFile(fieldMapPath, "utf8"), readFile(contractPath)
]);
const schema = JSON.parse(schemaBytes.toString("utf8")) as { catalogVersion: "SC-20260902-1"; columns: DomainImportPolicy["columns"] };
const identity = JSON.parse(identityText) as { generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] };
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const disposition = JSON.parse(dispositionText) as { definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[]; derived?: string[] };
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const contract = JSON.parse(contractBytes.toString("utf8")) as { profileSemanticSha256?: string; amendmentSemanticSha256?: Record<string, string>; componentSemanticSha256: DomainImportPolicy["contractComponentSemanticSha256"]; semanticHashPolicy: { acceptedCompatibleImportContractSha256: string[] } };
let directTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
let definitionTargets = disposition.definitionSeed;
let columns = schema.columns;
let generatedBindings = identity.generatedCuidBindings;
let foreignKeys = objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).filter((foreignKey) => "column" in foreignKey).map((foreignKey) => ({ table: table.table, ...foreignKey })));
let domainTargets = Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables]));
let exactDefinitionImports: DomainImportExactDefinitionImport[] | undefined;
if (profileVersion !== "v1") {
  const profileText = await readFile(resolve("../migration-control/contracts/object-domain-import-profile.v2.json"), "utf8");
  if (profileVersion === "v2" && contract.profileSemanticSha256 !== calculateObjectDomainImportProfileV2Sha256(profileText)) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V2_HASH_MISMATCH");
  const profile = parseObjectDomainImportProfileV2(profileText);
  exactDefinitionImports = profile.directTargetAdditions.map((target) => ({ table: target.table, definitionTable: target.foreignKey.referencesTable, definitionPkColumn: target.foreignKey.referencesColumn, foreignKeyColumn: target.foreignKey.column, sourceSystem: target.exactSource.sourceSystem, sourceNamespace: target.exactSource.sourceNamespace, sourceIdentifier: target.exactSource.sourceIdentifier, sourceIdentifierOrigin: target.exactSource.sourceIdentifierOrigin }));
  const effective = applyObjectDomainImportProfileV2({ columns, generatedBindings, foreignKeys, definitionTargets, directTargets, domainTargets }, profile);
  ({ columns, generatedBindings, foreignKeys, definitionTargets, directTargets, domainTargets } = effective);
}
let itemBagCompletenessV3: DomainImportPolicy["itemBagCompletenessV3"];
if (profileVersion === "v3" || profileVersion === "v4") {
  const v3ProfileText = await readFile(resolve("../migration-control/contracts/object-domain-import-profile.v3.json"), "utf8");
  const v3Profile = parseObjectDomainImportProfileV3(v3ProfileText);
  if (profileVersion === "v3" && contract.profileSemanticSha256 !== calculateObjectDomainImportProfileV3Sha256(v3ProfileText)) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V3_HASH_MISMATCH");
  itemBagCompletenessV3 = { profileVersion: v3Profile.profileVersion, profileSemanticSha256: calculateObjectDomainImportProfileV3Sha256(v3ProfileText), sourceNamespace: v3Profile.completenessProjection.sourceNamespace, witnessRecordDomain: v3Profile.completenessProjection.witnessRecordDomain, witnessRecordKind: v3Profile.completenessProjection.witnessRecordKind, sourceKeyRecordKinds: v3Profile.completenessProjection.sourceKeyRecordKinds };
}
if (profileVersion === "v4") {
  const v4ProfileText = await readFile(resolve("../migration-control/contracts/object-domain-import-profile.v4.json"), "utf8");
  if (contract.profileSemanticSha256 !== calculateObjectDomainImportProfileV4Sha256(v4ProfileText)) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V4_HASH_MISMATCH");
  const v4Profile = parseObjectDomainImportProfileV4(v4ProfileText);
  const [v4DispositionText, v4SchemaText, v4FieldMapText] = await Promise.all([readFile(resolve(`../migration-control/contracts/${v4Profile.dispositionAmendment}`), "utf8"), readFile(resolve(`../migration-control/contracts/${v4Profile.targetSchemaAmendment}`), "utf8"), readFile(resolve(`../migration-control/contracts/${v4Profile.fieldMapAmendment}`), "utf8")]);
  const actualAmendmentHashes = { disposition: calculateObjectDomainImportSemanticSha256(v4DispositionText), targetSchema: calculateObjectDomainImportSemanticSha256(v4SchemaText), fieldMap: calculateObjectDomainImportSemanticSha256(v4FieldMapText) };
  if (contract.amendmentSemanticSha256?.disposition !== actualAmendmentHashes.disposition || contract.amendmentSemanticSha256.targetSchema !== actualAmendmentHashes.targetSchema || contract.amendmentSemanticSha256.fieldMap !== actualAmendmentHashes.fieldMap) throw new Error("OBJECT_DOMAIN_IMPORT_PROFILE_V4_AMENDMENT_HASH_MISMATCH");
  const v4Schema = parseObjectDomainImportTargetSchemaV4(v4SchemaText);
  ({ columns, generatedBindings, foreignKeys, definitionTargets, directTargets, domainTargets } = applyObjectDomainImportProfileV4({ columns, generatedBindings, foreignKeys, definitionTargets, directTargets, domainTargets }, v4Schema));
}
const projectionVersion = profileVersion === "v2" ? OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V2 : profileVersion === "v3" ? OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V3 : profileVersion === "v4" ? OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V4 : undefined;
const effectiveSchemaText = profileVersion === "v1" ? schemaBytes.toString("utf8") : JSON.stringify({ catalogVersion: schema.catalogVersion, columns });
const importContractSha256 = calculateObjectDomainImportContractSemanticSha256(contractBytes.toString("utf8"));
const policy: DomainImportPolicy = {
  catalogVersion: schema.catalogVersion,
  targetSchemaSha256: calculateCatalogTargetSchemaSha256(effectiveSchemaText),
  importContractSha256,
  acceptedImportContractSha256: profileVersion === "v1" ? [importContractSha256, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256] : [importContractSha256],
  componentSemanticSha256: {
    identityBindings: calculateObjectDomainImportComponentSemanticSha256("identityBindings", JSON.stringify({ ...identity, generatedCuidBindings: generatedBindings }), directTargets, projectionVersion),
    objectModel: calculateObjectDomainImportComponentSemanticSha256("objectModel", objectModelText, directTargets, projectionVersion),
    disposition: calculateObjectDomainImportComponentSemanticSha256("disposition", JSON.stringify({ ...disposition, definitionSeed: definitionTargets, derived: disposition.derived?.filter((table) => !directTargets.includes(table)) }), directTargets, projectionVersion),
    fieldMap: calculateObjectDomainImportComponentSemanticSha256("fieldMap", JSON.stringify({ ...fieldMap, mappings: fieldMap.mappings.map((mapping) => ({ ...mapping, targetTables: domainTargets[mapping.domain] })) }), directTargets, projectionVersion)
  },
  contractComponentSemanticSha256: contract.componentSemanticSha256,
  columns,
  generatedBindings,
  reusedBindings: identity.reusedPrimaryKeys,
  foreignKeys,
  directTargets,
  definitionTargets,
  domainTargets,
  quarantineReasons: fieldMap.recordQuarantine,
  exactDefinitionImports,
  itemBagCompletenessV3
};
const config = loadConfig();
assertObjectDomainImportDatabaseName(config.database.name);
const database = createDatabaseClient(config.database);
try {
  const importer = new MariaObjectDomainImporter(database);
  const result = process.argv.includes("--rollback")
    ? { status: "ROLLED_BACK", deletedRuns: await importer.rollback(catalogProjectionRunId, policy) }
    : { status: "PASS", ...(await importer.importProjection(catalogProjectionRunId, policy, "object-domain-import")) };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await database.close();
}
