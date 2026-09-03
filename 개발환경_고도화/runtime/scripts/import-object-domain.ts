import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { assertObjectDomainImportDatabaseName, calculateObjectDomainImportSemanticSha256, MariaObjectDomainImporter, type DomainImportPolicy } from "../src/data-migration/object-domain-importer.js";
import { calculateCatalogTargetSchemaSha256 } from "../src/data-migration/catalog-projection-provider.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const catalogProjectionRunId = argument("--catalog-projection-run");
if (catalogProjectionRunId === undefined) throw new Error("USAGE: --catalog-projection-run <CUID2> [--rollback] [--target-schema <json>] [--identity-bindings <json>] [--object-model <json>] [--disposition <json>] [--field-map <json>] [--contract <json>]");
const schemaPath = argument("--target-schema") ?? resolve("../migration-control/contracts/object-domain-import-target-schema.v1.json");
const identityPath = argument("--identity-bindings") ?? resolve("../migration-control/contracts/object-domain-import-identity-bindings.v1.json");
const objectModelPath = argument("--object-model") ?? resolve("../migration-control/contracts/object-data-model-standard.v1.json");
const dispositionPath = argument("--disposition") ?? resolve("../migration-control/contracts/object-domain-import-disposition.v1.json");
const fieldMapPath = argument("--field-map") ?? resolve("../migration-control/contracts/object-domain-import-field-map.v1.json");
const contractPath = argument("--contract") ?? resolve("../migration-control/contracts/data-migration-object-domain-import.v1.json");
const [schemaBytes, identityText, objectModelText, dispositionText, fieldMapText, contractBytes] = await Promise.all([
  readFile(schemaPath), readFile(identityPath, "utf8"), readFile(objectModelPath, "utf8"), readFile(dispositionPath, "utf8"), readFile(fieldMapPath, "utf8"), readFile(contractPath)
]);
const schema = JSON.parse(schemaBytes.toString("utf8")) as { catalogVersion: "SC-20260902-1"; columns: DomainImportPolicy["columns"] };
const identity = JSON.parse(identityText) as { generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] };
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const disposition = JSON.parse(dispositionText) as { definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[] };
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const contract = JSON.parse(contractBytes.toString("utf8")) as { componentSemanticSha256: DomainImportPolicy["contractComponentSemanticSha256"] };
const policy: DomainImportPolicy = {
  catalogVersion: schema.catalogVersion,
  targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaBytes.toString("utf8")),
  importContractSha256: calculateObjectDomainImportSemanticSha256(contractBytes.toString("utf8")),
  componentSemanticSha256: {
    identityBindings: calculateObjectDomainImportSemanticSha256(identityText),
    objectModel: calculateObjectDomainImportSemanticSha256(objectModelText),
    disposition: calculateObjectDomainImportSemanticSha256(dispositionText),
    fieldMap: calculateObjectDomainImportSemanticSha256(fieldMapText)
  },
  contractComponentSemanticSha256: contract.componentSemanticSha256,
  columns: schema.columns,
  generatedBindings: identity.generatedCuidBindings,
  reusedBindings: identity.reusedPrimaryKeys,
  foreignKeys: objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
  directTargets: [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly],
  definitionTargets: disposition.definitionSeed,
  domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])),
  quarantineReasons: fieldMap.recordQuarantine
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
