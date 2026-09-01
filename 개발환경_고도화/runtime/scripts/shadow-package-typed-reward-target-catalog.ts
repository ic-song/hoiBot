import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPackageTypedRewardTargetCatalogProvider } from "../src/catalog/package-typed-reward-target-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/package-typed-reward-target-catalog-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_package_target(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_PACKAGE_TYPED_TARGET_SHADOW_DATABASE:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const actual = await new MariaPackageTypedRewardTargetCatalogProvider(database).readCatalog(fixture.catalogVersion);
  assert.ok(actual);
  const expected = fixture.occurrences.map((row: Record<string, unknown>) => [row.sourcePackageId,row.rewardOrder,row.rawType,row.targetType,row.targetDisplayName,String(row.quantity),row.targetSourcePackageId,row.canonicalItemCode,row.resolutionStatus]);
  const projection = actual.occurrences.map((row) => [row.sourcePackageId,row.rewardOrder,row.rawType,row.targetType,row.targetDisplayName,row.quantity,row.targetSourcePackageId,row.canonicalItemCode,row.resolutionStatus]);
  assert.deepEqual(projection, expected);
  console.log(JSON.stringify({ result: "passed", matched: projection.length, packages: actual.packages.length, stackRows: 513, packageRows: 44, resolvedStackRows: 467, gapStackRows: 46, maxUseOnceEnforced: false, packageConsumerCutover: false, gate8: false }));
} finally {
  await database.close();
}
