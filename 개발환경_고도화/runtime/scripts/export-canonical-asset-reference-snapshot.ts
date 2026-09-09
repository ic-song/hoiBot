import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsedMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function miniPetStatSignature(value: unknown): string | undefined {
  const metadata = parsedMetadata(value);
  const battle = metadata.battleExp;
  const castle = metadata.castleExp;
  const raid = metadata.raidExp;
  if (battle === undefined || castle === undefined || raid === undefined) return undefined;
  return `battle:${String(battle)}|castle:${String(castle)}|raid:${String(raid)}`;
}

const output = argument("--output");
const catalogVersion = argument("--catalog-version");
if (!output || !catalogVersion) throw new Error("USAGE: --output <private-json> --catalog-version <version>");
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_reference_validation(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_ASSET_REFERENCE_DATABASE:${config.database.name}`);
}

let database = createDatabaseClient(config.database);
try {
  const objects = await database.query<Array<{
    id: bigint; object_key: string; object_type: string; display_name: string; active: number | boolean; metadata_json: unknown;
  }>>("SELECT id,object_key,object_type,display_name,active,metadata_json FROM object_registry ORDER BY object_type,object_key");
  const bindings = await database.query<Array<{
    object_id: bigint; source_system: string; source_table: string; source_key: string;
  }>>("SELECT object_id,source_system,source_table,source_key FROM object_source_bindings ORDER BY object_id,source_system,source_table,source_key");
  const miniPetCatalog = await database.query<Array<{ item_id: string; metadata_json: unknown }>>(
    "SELECT item_id,metadata_json FROM package_item_definitions WHERE item_type='MINI_PET' ORDER BY item_id"
  );
  const titleCatalog = await database.query<Array<{
    stable_code: string; source_scope: string; display_name: string; active_snapshot: number | boolean; definition_version: number;
  }>>(`SELECT stable_code,source_scope,display_name,active_snapshot,definition_version
       FROM title_definition_catalog_entries
       WHERE catalog_version_id=(SELECT id FROM title_definition_catalog_versions ORDER BY id DESC LIMIT 1)
       ORDER BY source_scope,stable_code`);
  const packages = await database.query<Array<{
    package_id: string; display_name: string; enabled: number | boolean; definition_status: string;
  }>>("SELECT package_id,display_name,enabled,definition_status FROM package_catalog WHERE deleted_at IS NULL ORDER BY package_id");
  const sourcePackages = await database.query<Array<{
    source_package_id: string; display_name: string; enabled: number | boolean; catalog_version: string;
  }>>(`SELECT definition.source_package_id,definition.display_name,definition.enabled,catalog.catalog_version
       FROM asset_package_source_definitions definition
       JOIN asset_package_typed_target_catalogs catalog ON catalog.id=definition.catalog_id
       WHERE definition.catalog_id=(SELECT id FROM asset_package_typed_target_catalogs ORDER BY id DESC LIMIT 1)
       ORDER BY definition.source_order`);
  const passes = await database.query<Array<{
    pass_code: string; display_name: string; active: number | boolean;
  }>>("SELECT pass_code,display_name,active FROM support_pass_definitions ORDER BY pass_code");
  const sources = new Map<string, Array<{ sourceSystem: string; sourceTable: string; sourceKey: string }>>();
  for (const binding of bindings) {
    const key = binding.object_id.toString();
    const rows = sources.get(key) ?? [];
    rows.push({ sourceSystem: binding.source_system, sourceTable: binding.source_table, sourceKey: binding.source_key });
    sources.set(key, rows);
  }
  const miniPetSignatures = new Map(miniPetCatalog.map((entry) => [entry.item_id, miniPetStatSignature(entry.metadata_json)]));
  let miniPetSignatureCount = 0;
  const registryEntries = objects.map((object) => {
    const metadata = parsedMetadata(object.metadata_json);
    if (object.object_type === "MINI_PET") {
      const definitionCode = typeof metadata.definitionCode === "string" ? metadata.definitionCode : undefined;
      const signature = definitionCode ? miniPetSignatures.get(definitionCode) : undefined;
      if (signature) {
        metadata.legacyStatSignature = signature;
        miniPetSignatureCount += 1;
      }
    }
    return {
      objectId: object.id.toString(), objectKey: object.object_key, objectType: object.object_type,
      displayName: object.display_name, active: Boolean(object.active), metadata,
      sources: sources.get(object.id.toString()) ?? []
    };
  });
  const titleRegistryByCode = new Map<string, (typeof registryEntries)[number]>();
  for (const entry of registryEntries) {
    if (entry.objectType === "TITLE" && typeof entry.metadata.definitionCode === "string") {
      titleRegistryByCode.set(entry.metadata.definitionCode, entry);
    }
  }
  const additionalTitleEntries: Array<(typeof registryEntries)[number]> = [];
  for (const entry of titleCatalog) {
    const existing = titleRegistryByCode.get(entry.stable_code);
    const source = { sourceSystem: "TITLE_CATALOG", sourceTable: "title_definition_catalog_entries", sourceKey: entry.stable_code };
    if (existing) {
      existing.sources.push(source);
      existing.metadata.sourceScope = entry.source_scope;
      existing.metadata.definitionVersion = entry.definition_version;
    } else {
      additionalTitleEntries.push({
        objectId: `title-definition:${entry.stable_code}`,
        objectKey: entry.stable_code,
        objectType: "TITLE",
        displayName: entry.display_name,
        active: Boolean(entry.active_snapshot),
        metadata: { definitionCode: entry.stable_code, sourceScope: entry.source_scope, definitionVersion: entry.definition_version },
        sources: [source]
      });
    }
  }
  const packageEntries = new Map<string, {
    objectId: string; objectKey: string; objectType: string; displayName: string; active: boolean;
    metadata: Record<string, unknown>; sources: Array<{ sourceSystem: string; sourceTable: string; sourceKey: string }>;
  }>();
  for (const entry of sourcePackages) {
    packageEntries.set(entry.source_package_id, {
      objectId: `package-definition:${entry.source_package_id}`,
      objectKey: entry.source_package_id,
      objectType: "PACKAGE_DEFINITION",
      displayName: entry.display_name,
      active: Boolean(entry.enabled),
      metadata: { sourceCatalogVersion: entry.catalog_version },
      sources: [{ sourceSystem: "ASSET_PACKAGE_CATALOG", sourceTable: "asset_package_source_definitions", sourceKey: entry.source_package_id }]
    });
  }
  for (const entry of packages) {
    const existing = packageEntries.get(entry.package_id);
    if (existing) {
      existing.sources.push({ sourceSystem: "PACKAGE_CATALOG", sourceTable: "package_catalog", sourceKey: entry.package_id });
      existing.metadata.runtimeDefinitionStatus = entry.definition_status;
      existing.metadata.runtimeEnabled = Boolean(entry.enabled);
    } else {
      packageEntries.set(entry.package_id, {
        objectId: `package-definition:${entry.package_id}`,
        objectKey: entry.package_id,
        objectType: "PACKAGE_DEFINITION",
        displayName: entry.display_name,
        active: Boolean(entry.enabled),
        metadata: { runtimeDefinitionStatus: entry.definition_status },
        sources: [{ sourceSystem: "PACKAGE_CATALOG", sourceTable: "package_catalog", sourceKey: entry.package_id }]
      });
    }
  }
  const entries = [
    ...registryEntries,
    ...additionalTitleEntries,
    ...packageEntries.values(),
    ...passes.map((entry) => ({
      objectId: `pass-definition:${entry.pass_code}`,
      objectKey: entry.pass_code,
      objectType: "PASS",
      displayName: entry.display_name,
      active: Boolean(entry.active),
      metadata: {},
      sources: [{ sourceSystem: "PASS_CATALOG", sourceTable: "support_pass_definitions", sourceKey: entry.pass_code }]
    }))
  ];
  const snapshot = { format: "hoibot-canonical-asset-reference-v1", catalogVersion, generatedAt: new Date().toISOString(), entries };
  const serialized = `${JSON.stringify(snapshot)}\n`;
  const target = resolve(output);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, target);
  await database.close();
  database = createDatabaseClient(config.database);
  const replayObjectCount = Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM object_registry"))[0]!.count);
  const replayPackageCount = Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM package_catalog WHERE deleted_at IS NULL"))[0]!.count);
  const replaySourcePackageCount = Number((await database.query<Array<{ count: bigint }>>(
    "SELECT COUNT(*) count FROM asset_package_source_definitions WHERE catalog_id=(SELECT id FROM asset_package_typed_target_catalogs ORDER BY id DESC LIMIT 1)"
  ))[0]!.count);
  const replayPassCount = Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM support_pass_definitions"))[0]!.count);
  const replayTitleCount = Number((await database.query<Array<{ count: bigint }>>(
    "SELECT COUNT(*) count FROM title_definition_catalog_entries WHERE catalog_version_id=(SELECT id FROM title_definition_catalog_versions ORDER BY id DESC LIMIT 1)"
  ))[0]!.count);
  if (replayObjectCount !== registryEntries.length || replayPackageCount !== packages.length || replaySourcePackageCount !== sourcePackages.length || replayPassCount !== passes.length || replayTitleCount !== titleCatalog.length) {
    throw new Error("CANONICAL_SNAPSHOT_RECONNECT_MISMATCH");
  }
  process.stdout.write(`${JSON.stringify({
    status: "PASS", catalogVersion, objectCount: entries.length, registryObjectCount: registryEntries.length,
    packageDefinitionCount: packageEntries.size, packageSourceDefinitionCount: sourcePackages.length,
    packageRuntimeDefinitionCount: packages.length, passDefinitionCount: passes.length,
    miniPetCatalogCount: miniPetCatalog.length, miniPetSignatureCount,
    titleDefinitionCount: titleCatalog.length, titleVirtualDefinitionCount: additionalTitleEntries.length,
    bindingCount: bindings.length + sourcePackages.length + packages.length + passes.length, registryBindingCount: bindings.length,
    snapshotSha256: createHash("sha256").update(serialized).digest("hex"), reconnect: true
  })}\n`);
} finally {
  await database.close();
}
