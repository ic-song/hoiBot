import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaMiniPetCollectionRewardCatalogProvider } from "../src/catalog/mini-pet-collection-reward-catalog.js";

const oldCatalogVersion = "ASSET-FREEZE-v2.435-mini-pet-collection-reward-01";
const newCatalogVersion = "ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01";
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_minipet_collection_reward(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_MINI_PET_COLLECTION_REWARD_DATABASE:${config.database.name}`);
}

let database = createDatabaseClient(config.database);
const checks: string[] = [];

try {
  const provider = new MariaMiniPetCollectionRewardCatalogProvider(database);
  const oldCatalog = await provider.readCatalog(oldCatalogVersion);
  const newCatalog = await provider.readCatalog(newCatalogVersion);
  assert.ok(oldCatalog);
  assert.ok(newCatalog);
  assert.equal(oldCatalog.occurrences.length, 108);
  assert.equal(newCatalog.occurrences.length, 108);
  assert.equal(oldCatalog.occurrences.filter((row) => row.titleResolution === "UNRESOLVED").length, 100);
  assert.equal(newCatalog.occurrences.filter((row) => row.titleResolution === "RESOLVED").length, 100);
  assert.equal(newCatalog.occurrences.filter((row) => row.titleResolution === "NOT_APPLICABLE").length, 8);
  assert.equal(newCatalog.occurrences.filter((row) => row.titleResolution === "UNRESOLVED" || row.titleResolution === "CONFLICT").length, 0);
  checks.push("old immutable snapshot and new resolved catalog parity");

  const identities = await database.query<Array<{ objects: bigint; bindings: bigint; definition_codes: bigint; source_rows: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM object_registry WHERE object_type='TITLE' AND object_key LIKE 'title.mini_pet_collection.stage_%.v1'
      AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) objects,
    (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='TITLE' AND source_system='LEGACY_JSON'
      AND source_table='data/miniPetCollectionInfo.json#titles') bindings,
    (SELECT COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.definitionCode'))) FROM object_registry
      WHERE object_type='TITLE' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) definition_codes,
    (SELECT COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.sourceRow'))) FROM object_registry
      WHERE object_type='TITLE' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) source_rows`,
    [newCatalogVersion, newCatalogVersion, newCatalogVersion]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(identities[0]!).map(([key, value]) => [key, Number(value)])),
    { objects: 100, bindings: 100, definition_codes: 100, source_rows: 100 }
  );
  checks.push("100 stable objects, definitions, source rows, and bindings");

  assert.deepEqual(
    newCatalog.occurrences.map((row) => [row.globalSourceOrder, row.sourceScope, row.sourceKey, row.quantity, row.titleDisplayName]),
    oldCatalog.occurrences.map((row) => [row.globalSourceOrder, row.sourceScope, row.sourceKey, row.quantity, row.titleDisplayName])
  );
  checks.push("108 source rows preserved without display-name identity merge");

  await database.close();
  database = createDatabaseClient(config.database);
  const afterReconnect = await new MariaMiniPetCollectionRewardCatalogProvider(database).readCatalog(newCatalogVersion);
  assert.equal(afterReconnect?.occurrences.filter((row) => row.titleResolution === "RESOLVED").length, 100);
  checks.push("provider reconnect parity");

  console.log(JSON.stringify({
    result: "passed",
    checks,
    total: checks.length,
    catalogVersion: newCatalogVersion,
    titleObjects: 100,
    sourceBindings: 100,
    occurrences: 108,
    resolved: 100,
    notApplicable: 8,
    conflicts: 0,
    gaps: 0,
    publicationStatus: newCatalog.publicationStatus,
    providerReused: true,
    consumerCutover: false,
    operationalDataTouched: false
  }));
} finally {
  await database.close();
}
