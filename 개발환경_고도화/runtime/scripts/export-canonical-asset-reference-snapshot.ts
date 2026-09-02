import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
  const sources = new Map<string, Array<{ sourceSystem: string; sourceTable: string; sourceKey: string }>>();
  for (const binding of bindings) {
    const key = binding.object_id.toString();
    const rows = sources.get(key) ?? [];
    rows.push({ sourceSystem: binding.source_system, sourceTable: binding.source_table, sourceKey: binding.source_key });
    sources.set(key, rows);
  }
  const entries = objects.map((object) => ({
    objectId: object.id.toString(), objectKey: object.object_key, objectType: object.object_type,
    displayName: object.display_name, active: Boolean(object.active),
    metadata: typeof object.metadata_json === "string" ? JSON.parse(object.metadata_json) : (object.metadata_json ?? {}),
    sources: sources.get(object.id.toString()) ?? []
  }));
  const snapshot = { format: "hoibot-canonical-asset-reference-v1", catalogVersion, generatedAt: new Date().toISOString(), entries };
  const serialized = `${JSON.stringify(snapshot)}\n`;
  const target = resolve(output);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, target);
  await database.close();
  database = createDatabaseClient(config.database);
  const replayCount = Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM object_registry"))[0]!.count);
  if (replayCount !== entries.length) throw new Error("CANONICAL_SNAPSHOT_RECONNECT_MISMATCH");
  process.stdout.write(`${JSON.stringify({ status: "PASS", catalogVersion, objectCount: entries.length, bindingCount: bindings.length, snapshotSha256: createHash("sha256").update(serialized).digest("hex"), reconnect: true })}\n`);
} finally {
  await database.close();
}
