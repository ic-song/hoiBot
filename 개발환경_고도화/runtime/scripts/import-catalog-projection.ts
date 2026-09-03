import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import {
  assertCatalogProjectionDatabaseName,
  calculateCatalogProjectionManifestSha256,
  MariaCatalogProjectionRepository,
  type CatalogGeneratedIdentityBinding,
  type CatalogForeignKeyBinding,
  type CatalogProjectionManifest,
  type CatalogProjectionPolicy,
  type CatalogReusedIdentityBinding,
  type CatalogTargetSchemaColumn
} from "../src/data-migration/catalog-projection-provider.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPath = argument("--manifest");
if (manifestPath === undefined) throw new Error("USAGE: --manifest <catalog-projection-manifest.json> [--target-schema <json>] [--identity-bindings <json>] [--object-model <json>] [--rollback]");
const schemaPath = argument("--target-schema") ?? resolve("../migration-control/contracts/object-domain-import-target-schema.v1.json");
const bindingsPath = argument("--identity-bindings") ?? resolve("../migration-control/contracts/object-domain-import-identity-bindings.v1.json");
const objectModelPath = argument("--object-model") ?? resolve("../migration-control/contracts/object-data-model-standard.v1.json");
const fieldMapPath = argument("--field-map") ?? resolve("../migration-control/contracts/object-domain-import-field-map.v1.json");
const [manifestText, schemaBytes, bindingsText, objectModelText, fieldMapText] = await Promise.all([readFile(resolve(manifestPath), "utf8"), readFile(schemaPath), readFile(bindingsPath, "utf8"), readFile(objectModelPath, "utf8"), readFile(fieldMapPath, "utf8")]);
const manifest = JSON.parse(manifestText) as CatalogProjectionManifest;
const schema = JSON.parse(schemaBytes.toString("utf8")) as { columns: CatalogTargetSchemaColumn[] };
const bindings = JSON.parse(bindingsText) as { generatedCuidBindings: CatalogGeneratedIdentityBinding[]; reusedPrimaryKeys: CatalogReusedIdentityBinding[] };
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const fieldMap = JSON.parse(fieldMapText) as { recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> };
const policy: CatalogProjectionPolicy = {
  targetSchemaSha256: createHash("sha256").update(schemaBytes).digest("hex"),
  columns: schema.columns,
  generatedCuidBindings: bindings.generatedCuidBindings,
  reusedPrimaryKeys: bindings.reusedPrimaryKeys,
  foreignKeys: objectModel.tables.flatMap((table): CatalogForeignKeyBinding[] => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey })))
  ,domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])), quarantineReasons: fieldMap.recordQuarantine
};
const config = loadConfig();
assertCatalogProjectionDatabaseName(config.database.name);
const database = createDatabaseClient(config.database);
try {
  const repository = new MariaCatalogProjectionRepository(database);
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
