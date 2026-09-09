import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaMiniPetCollectionRewardCatalogProvider } from "../src/catalog/mini-pet-collection-reward-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/mini-pet-collection-reward-catalog-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_minipet_collection_reward(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_MINI_PET_COLLECTION_REWARD_SHADOW_DATABASE:${config.database.name}`);
}
const database = createDatabaseClient(config.database);

try {
  const actual = await new MariaMiniPetCollectionRewardCatalogProvider(database).readCatalog(fixture.catalogVersion);
  assert.ok(actual);
  const expectedProjection = fixture.occurrences.map((row: Record<string, unknown>) => ({
    sourceScope: row.sourceScope,
    sourceKey: row.sourceKey,
    sourceOrder: row.sourceOrder,
    item: row.rawItemDisplayName,
    quantity: String(row.quantity),
    title: row.titleDisplayName,
    titlePrice: row.titlePrice === null ? null : String(row.titlePrice)
  }));
  const actualProjection = actual.occurrences.map((row) => ({
    sourceScope: row.sourceScope,
    sourceKey: row.sourceKey,
    sourceOrder: row.sourceOrder,
    item: row.rawItemDisplayName,
    quantity: row.quantity,
    title: row.titleDisplayName,
    titlePrice: row.titlePrice
  }));
  assert.deepEqual(actualProjection, expectedProjection);
  console.log(JSON.stringify({ result: "passed", matched: actualProjection.length, gradeRewards: 8, stageRewards: 100, rewardTarget: actual.rewardTarget.itemCode, stableTitleBindings: actual.occurrences.filter((row) => row.titleResolution === "RESOLVED").length, unresolvedTitleBindings: actual.occurrences.filter((row) => row.titleResolution === "UNRESOLVED").length, rewardConsumerCutover: false, gate8: false }));
} finally {
  await database.close();
}
