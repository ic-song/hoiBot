import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaMiniPetCollectionRewardCatalogProvider } from "../src/catalog/mini-pet-collection-reward-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/mini-pet-collection-reward-catalog-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_minipet_collection_reward(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_MINI_PET_COLLECTION_REWARD_DATABASE:${config.database.name}`);
}
let database = createDatabaseClient(config.database);
const checks: string[] = [];

try {
  const provider = new MariaMiniPetCollectionRewardCatalogProvider(database);
  const actual = await provider.readCatalog(fixture.catalogVersion);
  assert.ok(actual);
  assert.equal(actual.sourceSha256, fixture.sourceSha256);
  assert.deepEqual(actual.rewardTarget, {
    itemId: actual.rewardTarget.itemId,
    objectId: actual.rewardTarget.objectId,
    itemCode: "pet_food",
    objectKey: "item.direct_bag.3076ae479a9eb44e",
    displayName: "펫먹이🍼",
    ownershipModel: "STACK"
  });
  checks.push("stable pet-food item and object binding");

  assert.deepEqual(actual.occurrences.map((row) => [row.sourceScope, row.sourceKey, row.sourceOrder, row.rawItemDisplayName, row.quantity, row.titleDisplayName, row.titlePrice, row.displayIdentityHash]),
    fixture.occurrences.map((row: Record<string, unknown>) => [row.sourceScope, row.sourceKey, row.sourceOrder, row.rawItemDisplayName, String(row.quantity), row.titleDisplayName, row.titlePrice === null ? null : String(row.titlePrice), row.displayIdentityHash]));
  checks.push("108 ordered occurrence parity");

  const resolutions = Object.fromEntries(["RESOLVED", "UNRESOLVED", "CONFLICT", "NOT_APPLICABLE"].map((status) => [status, actual.occurrences.filter((row) => row.titleResolution === status).length]));
  assert.deepEqual(resolutions, { RESOLVED: 0, UNRESOLVED: 100, CONFLICT: 0, NOT_APPLICABLE: 8 });
  checks.push("100 unresolved title bindings isolated");

  const totals = (await database.query<Array<{ catalogs: bigint; occurrences: bigint; reward_items: bigint; reward_objects: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM mini_pet_collection_reward_catalogs WHERE catalog_version=?) catalogs,
    (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id WHERE catalog.catalog_version=?) occurrences,
    (SELECT COUNT(*) FROM item_definitions WHERE code='pet_food' AND display_name='펫먹이🍼' AND active=TRUE) reward_items,
    (SELECT COUNT(*) FROM object_registry WHERE object_key='item.direct_bag.3076ae479a9eb44e' AND object_type='ITEM' AND active=TRUE) reward_objects`, [fixture.catalogVersion, fixture.catalogVersion]))[0]!;
  assert.deepEqual({ catalogs: Number(totals.catalogs), occurrences: Number(totals.occurrences), rewardItems: Number(totals.reward_items), rewardObjects: Number(totals.reward_objects) },
    { catalogs: 1, occurrences: 108, rewardItems: 1, rewardObjects: 1 });
  checks.push("catalog totals and canonical dependency cardinality");

  const before = actual.occurrences[0]!.quantity;
  await assert.rejects(database.withTransaction(async (transaction) => {
    await transaction.execute(`UPDATE mini_pet_collection_reward_occurrences occurrence
      JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
       SET occurrence.quantity=1
     WHERE catalog.catalog_version=? AND occurrence.global_source_order=1`, [fixture.catalogVersion]);
    throw new Error("ROLLBACK_SENTINEL");
  }), /ROLLBACK_SENTINEL/);
  const afterRollback = await provider.readCatalog(fixture.catalogVersion);
  assert.equal(afterRollback?.occurrences[0]!.quantity, before);
  checks.push("transaction rollback");

  await database.close();
  database = createDatabaseClient(config.database);
  const afterReconnect = await new MariaMiniPetCollectionRewardCatalogProvider(database).readCatalog(fixture.catalogVersion);
  assert.equal(afterReconnect?.occurrences.length, 108);
  checks.push("reconnect restart");

  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, catalogVersion: fixture.catalogVersion, occurrences: 108, titleResolution: resolutions, rewardConsumerCutover: false, ownershipRowsMutated: 0, operationalDataTouched: false }));
} finally {
  await database.close();
}
