import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPackageTypedRewardTargetCatalogProvider } from "../src/catalog/package-typed-reward-target-catalog.js";

const version = "ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01";
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_package_gap_closure(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_PACKAGE_GAP_CLOSURE_DATABASE:${config.database.name}`);
}

let database = createDatabaseClient(config.database);
try {
  const catalog = await new MariaPackageTypedRewardTargetCatalogProvider(database).readCatalog(version);
  assert.ok(catalog);
  assert.equal(catalog.packages.length, 107);
  assert.equal(catalog.occurrences.length, 557);
  const result = (await database.query<Array<{
    stack_bindings: bigint; package_bindings: bigint; stack_objects: bigint; package_objects: bigint; conflicts: bigint;
  }>>(`SELECT
    SUM(binding_row.object_type='ITEM') stack_bindings,
    SUM(binding_row.object_type='PACKAGE') package_bindings,
    COUNT(DISTINCT CASE WHEN binding_row.object_type='ITEM' THEN binding_row.object_id END) stack_objects,
    COUNT(DISTINCT CASE WHEN binding_row.object_type='PACKAGE' THEN binding_row.object_id END) package_objects,
    SUM(BINARY object_row.display_name<>BINARY occurrence.target_display_name) conflicts
  FROM object_source_bindings binding_row
  JOIN object_registry object_row ON object_row.id=binding_row.object_id
  JOIN asset_package_reward_target_occurrences occurrence
    ON occurrence.global_source_order=CAST(SUBSTRING_INDEX(binding_row.source_key,'#',-1) AS UNSIGNED)
  JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
  WHERE binding_row.source_system='RUNTIME_DB'
    AND binding_row.source_table='asset_package_reward_target_occurrences'
    AND binding_row.source_key LIKE ?
    AND catalog.catalog_version=?`, [`${version}#%`, version]))[0]!;
  assert.deepEqual(
    [Number(result.stack_bindings),Number(result.package_bindings),Number(result.stack_objects),Number(result.package_objects),Number(result.conflicts)],
    [46,44,16,21,0]
  );
  const before = JSON.stringify(catalog);
  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal(JSON.stringify(await new MariaPackageTypedRewardTargetCatalogProvider(database).readCatalog(version)), before);
  process.stdout.write(JSON.stringify({version,packages:107,occurrences:557,stackBindings:46,packageBindings:44,residualStackGap:0,residualPackageGap:0,conflicts:0,reconnect:true})+"\n");
} finally {
  await database.close();
}
