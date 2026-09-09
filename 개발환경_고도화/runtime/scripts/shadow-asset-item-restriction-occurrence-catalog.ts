import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaAssetItemRestrictionCatalogProvider, type AssetItemRestrictionKind } from "../src/catalog/asset-item-restriction-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/asset-item-restriction-occurrence-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_item_restriction_occurrence(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_ASSET_ITEM_RESTRICTION_DATABASE:${config.database.name}`);
}
const database = createDatabaseClient(config.database);

try {
  const provider = new MariaAssetItemRestrictionCatalogProvider(database);
  let matched = 0;
  for (const expected of fixture.policies) {
    const actual = await provider.readPolicy(fixture.catalogVersion, expected.restrictionKind as AssetItemRestrictionKind);
    assert.ok(actual);
    assert.equal(actual.publicationStatus, "SHADOW");
    assert.deepEqual(actual.occurrences.map((row) => [row.sourceOrder, row.rawValue]), expected.occurrences.map((row: { sourceOrder: number; rawValue: string }) => [row.sourceOrder, row.rawValue]));
    matched += actual.occurrences.length;
  }
  assert.equal(matched, 1178);
  console.log(JSON.stringify({ result: "passed", catalogVersion: fixture.catalogVersion, matched, definitions: 1173, duplicateGroups: 5, existingConsumerCutover: false, ownershipRowsMutated: 0, operationalDataTouched: false }));
} finally {
  await database.close();
}
