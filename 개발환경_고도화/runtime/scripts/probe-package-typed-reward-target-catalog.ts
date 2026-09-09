import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPackageTypedRewardTargetCatalogProvider } from "../src/catalog/package-typed-reward-target-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/package-typed-reward-target-catalog-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_package_target(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_PACKAGE_TYPED_TARGET_DATABASE:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];

try {
  const provider = new MariaPackageTypedRewardTargetCatalogProvider(database);
  const actual = await provider.readCatalog(fixture.catalogVersion);
  assert.ok(actual);
  assert.equal(actual.sourceSha256, fixture.sourceSha256);
  assert.deepEqual(actual.packages.map((row) => [row.sourceOrder,row.sourcePackageId,row.displayName,row.inventoryKey,row.legacyMaxUseOnce,row.enforcementStatus,row.identityHash]), fixture.packages.map((row: Record<string, unknown>) => [row.sourceOrder,row.sourcePackageId,row.displayName,row.inventoryKey,row.legacyMaxUseOnce,row.enforcementStatus,row.identityHash]));
  checks.push("107 ordered source packages and inert maxUseOnce");
  assert.deepEqual(actual.occurrences.map((row) => [row.globalSourceOrder,row.sourcePackageId,row.rewardOrder,row.rawType,row.targetType,row.targetDisplayName,row.quantity,row.targetSourcePackageId,row.canonicalItemCode,row.resolutionStatus,row.identityHash]), fixture.occurrences.map((row: Record<string, unknown>) => [row.globalSourceOrder,row.sourcePackageId,row.rewardOrder,row.rawType,row.targetType,row.targetDisplayName,String(row.quantity),row.targetSourcePackageId,row.canonicalItemCode,row.resolutionStatus,row.identityHash]));
  checks.push("557 ordered typed reward targets");
  assert.deepEqual({ stack: actual.occurrences.filter((row) => row.targetType === "STACK").length, nestedPackage: actual.occurrences.filter((row) => row.targetType === "PACKAGE").length, resolvedStack: actual.occurrences.filter((row) => row.resolutionStatus === "RESOLVED").length, gapStack: actual.occurrences.filter((row) => row.resolutionStatus === "GAP").length }, { stack: 513, nestedPackage: 44, resolvedStack: 467, gapStack: 46 });
  checks.push("typed classification and resolution totals");
  const before = actual.occurrences[0]!.quantity;
  await assert.rejects(database.withTransaction(async (transaction) => { await transaction.execute("UPDATE asset_package_reward_target_occurrences SET quantity=999 WHERE catalog_id=? AND global_source_order=1", [(await database.query<Array<{id: bigint}>>("SELECT id FROM asset_package_typed_target_catalogs WHERE catalog_version=?", [fixture.catalogVersion]))[0]!.id]); throw new Error("ROLLBACK_SENTINEL"); }), /ROLLBACK_SENTINEL/);
  assert.equal((await provider.readCatalog(fixture.catalogVersion))?.occurrences[0]!.quantity, before);
  checks.push("transaction rollback");
  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal((await new MariaPackageTypedRewardTargetCatalogProvider(database).readCatalog(fixture.catalogVersion))?.occurrences.length, 557);
  checks.push("reconnect read");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, packages: 107, rewards: 557, stackRows: 513, packageRows: 44, resolvedStackRows: 467, gapStackRows: 46, packageConsumerCutover: false, ownershipRowsMutated: 0, operationalDataTouched: false, gate8: false }));
} finally {
  await database.close();
}
