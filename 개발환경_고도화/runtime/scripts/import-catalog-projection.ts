import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import {
  assertCatalogProjectionDatabaseName,
  calculateLegacyCatalogTargetSchemaSha256s,
  calculateCatalogTargetSchemaSha256,
  calculateCatalogProjectionManifestSha256,
  MariaCatalogProjectionRepository,
  type CatalogGeneratedIdentityBinding,
  type CatalogForeignKeyBinding,
  type CatalogProjectionManifest,
  type CatalogProjectionPolicy,
  type CatalogReusedIdentityBinding,
  type CatalogTargetSchemaColumn
} from "../src/data-migration/catalog-projection-provider.js";
import { applyObjectDomainImportProfileV2, assertObjectDomainImportV2ProjectionManifest, parseObjectDomainImportProfileV2, resolveObjectDomainImportProfileVersion, type ObjectDomainImportProfileV2 } from "../src/data-migration/object-domain-import-profile.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPath = argument("--manifest");
if (manifestPath === undefined) throw new Error("USAGE: --manifest <catalog-projection-manifest.json> [--profile v1|v2] [--target-schema <json>] [--identity-bindings <json>] [--object-model <json>] [--rollback]");
const schemaPath = argument("--target-schema") ?? resolve("../migration-control/contracts/object-domain-import-target-schema.v1.json");
const bindingsPath = argument("--identity-bindings") ?? resolve("../migration-control/contracts/object-domain-import-identity-bindings.v1.json");
const objectModelPath = argument("--object-model") ?? resolve("../migration-control/contracts/object-data-model-standard.v1.json");
const fieldMapPath = argument("--field-map") ?? resolve("../migration-control/contracts/object-domain-import-field-map.v1.json");
const profileVersion = resolveObjectDomainImportProfileVersion(argument("--profile"));
const [manifestText, schemaBytes, bindingsText, objectModelText, fieldMapText] = await Promise.all([readFile(resolve(manifestPath), "utf8"), readFile(schemaPath), readFile(bindingsPath, "utf8"), readFile(objectModelPath, "utf8"), readFile(fieldMapPath, "utf8")]);
const manifest = JSON.parse(manifestText) as CatalogProjectionManifest;
const schema = JSON.parse(schemaBytes.toString("utf8")) as { columns: CatalogTargetSchemaColumn[] };
const bindings = JSON.parse(bindingsText) as { generatedCuidBindings: CatalogGeneratedIdentityBinding[]; reusedPrimaryKeys: CatalogReusedIdentityBinding[] };
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const baseForeignKeys = objectModel.tables.flatMap((table): CatalogForeignKeyBinding[] => (table.foreignKeys ?? []).filter((foreignKey) => "column" in foreignKey).map((foreignKey) => ({ table: table.table, ...foreignKey })));
const directTargets = fieldMap.mappings.flatMap((mapping) => mapping.targetTables);
let effective = { columns: schema.columns, generatedBindings: bindings.generatedCuidBindings, foreignKeys: baseForeignKeys, definitionTargets: [] as string[], directTargets, domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])) };
let profileV2: ObjectDomainImportProfileV2 | undefined;
if (profileVersion === "v2") { profileV2 = parseObjectDomainImportProfileV2(await readFile(resolve("../migration-control/contracts/object-domain-import-profile.v2.json"), "utf8")); effective = applyObjectDomainImportProfileV2(effective, profileV2); }
const effectiveSchemaText = JSON.stringify({ catalogVersion: "SC-20260902-1", columns: effective.columns });
const policy: CatalogProjectionPolicy = {
  targetSchemaSha256: profileVersion === "v2" ? calculateCatalogTargetSchemaSha256(effectiveSchemaText) : calculateCatalogTargetSchemaSha256(schemaBytes.toString("utf8")),
  legacyTargetSchemaSha256s: profileVersion === "v2" ? [] : calculateLegacyCatalogTargetSchemaSha256s(schemaBytes.toString("utf8")),
  columns: effective.columns,
  generatedCuidBindings: effective.generatedBindings,
  reusedPrimaryKeys: bindings.reusedPrimaryKeys,
  foreignKeys: effective.foreignKeys,
  domainTargets: effective.domainTargets, quarantineReasons: fieldMap.recordQuarantine
};
const config = loadConfig();
assertCatalogProjectionDatabaseName(config.database.name);
const database = createDatabaseClient(config.database);
try {
  const repository = new MariaCatalogProjectionRepository(database);
  if (profileV2 !== undefined) assertObjectDomainImportV2ProjectionManifest(manifest, profileV2);
  if (process.argv.includes("--rollback")) {
    const deletedRuns = await repository.rollback(manifest.commonStagingRunId, manifest.catalogVersion, calculateCatalogProjectionManifestSha256(manifest, policy));
    process.stdout.write(`${JSON.stringify({ status: "ROLLED_BACK", deletedRuns })}\n`);
  } else {
    const result = await repository.project(manifest, policy);
    process.stdout.write(`${JSON.stringify({ status: "PASS", ...result })}\n`);
  }
} finally {
  await database.close();
}
