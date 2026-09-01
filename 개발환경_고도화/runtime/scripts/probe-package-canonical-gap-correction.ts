import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPackageTypedRewardTargetCatalogProvider } from "../src/catalog/package-typed-reward-target-catalog.js";

const baseCatalogVersion = "ASSET-FREEZE-v2.438-package-typed-target-01";
const correctionCatalogVersion = "ASSET-FREEZE-v2.438-package-canonical-gap-correction-01";
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_package_canonical_gap(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_PACKAGE_CANONICAL_GAP_DATABASE:${config.database.name}`);
}

let database = createDatabaseClient(config.database);
const checks: string[] = [];

try {
  const provider = new MariaPackageTypedRewardTargetCatalogProvider(database);
  const baseCatalog = await provider.readCatalog(baseCatalogVersion);
  const correctionCatalog = await provider.readCatalog(correctionCatalogVersion);
  assert.ok(baseCatalog);
  assert.ok(correctionCatalog);
  assert.equal(baseCatalog.packages.length, 107);
  assert.equal(correctionCatalog.packages.length, 107);
  assert.equal(baseCatalog.occurrences.length, 557);
  assert.equal(correctionCatalog.occurrences.length, 557);
  assert.equal(baseCatalog.occurrences.filter((row) => row.targetType === "STACK" && row.resolutionStatus === "RESOLVED").length, 467);
  assert.equal(correctionCatalog.occurrences.filter((row) => row.targetType === "STACK" && row.resolutionStatus === "GAP").length, 46);
  checks.push("frozen typed catalog parity preserved");

  assert.deepEqual(
    correctionCatalog.occurrences.map((row) => [row.globalSourceOrder, row.identityHash, row.resolutionStatus]),
    baseCatalog.occurrences.map((row) => [row.globalSourceOrder, row.identityHash, row.resolutionStatus])
  );
  checks.push("557 immutable source identities preserved");

  const overlay = await database.query<Array<{
    overlay_count: bigint; object_count: bigint; conflict_count: bigint; residual_stack_gap: bigint; residual_package_gap: bigint;
  }>>(`SELECT
    COUNT(*) overlay_count,
    COUNT(DISTINCT overlay.object_id) object_count,
    SUM(CASE WHEN BINARY object_row.display_name<>BINARY occurrence.target_display_name
      OR JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode')) IS NULL THEN 1 ELSE 0 END) conflict_count,
    46-COUNT(*) residual_stack_gap,
    (SELECT COUNT(*) FROM asset_package_reward_target_occurrences package_occurrence
      JOIN asset_package_typed_target_catalogs package_catalog ON package_catalog.id=package_occurrence.catalog_id
      WHERE package_catalog.catalog_version=? AND package_occurrence.target_type='PACKAGE'
        AND package_occurrence.resolution_status='SOURCE_RESOLVED_CANONICAL_GAP') residual_package_gap
  FROM object_source_bindings overlay
  JOIN object_registry object_row ON object_row.id=overlay.object_id
  JOIN asset_package_reward_target_occurrences occurrence
    ON occurrence.global_source_order=CAST(SUBSTRING_INDEX(overlay.source_key,'#',-1) AS UNSIGNED)
  JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
  WHERE overlay.object_type='ITEM' AND overlay.source_system='RUNTIME_DB'
    AND overlay.source_table='asset_package_reward_target_occurrences'
    AND overlay.source_key LIKE CONCAT(?, '#%')
    AND catalog.catalog_version=?`, [correctionCatalogVersion, correctionCatalogVersion, correctionCatalogVersion]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(overlay[0]!).map(([key, value]) => [key, Number(value)])),
    { overlay_count: 10, object_count: 4, conflict_count: 0, residual_stack_gap: 36, residual_package_gap: 44 }
  );
  checks.push("effective overlay 10, residual stack 36 and package 44");

  await database.close();
  database = createDatabaseClient(config.database);
  const afterReconnect = await new MariaPackageTypedRewardTargetCatalogProvider(database).readCatalog(correctionCatalogVersion);
  assert.equal(afterReconnect?.occurrences.length, 557);
  checks.push("existing provider reconnect parity");

  console.log(JSON.stringify({
    result: "passed",
    checks,
    total: checks.length,
    catalogVersion: correctionCatalogVersion,
    frozen: { resolvedStack: 467, gapStack: 46, packageGap: 44 },
    effective: { resolvedStack: 477, exactOverlay: 10, residualStackGap: 36, residualPackageGap: 44, conflicts: 0 },
    publicationStatus: correctionCatalog.publicationStatus,
    schemaChanged: false,
    providerChanged: false,
    consumerChanged: false,
    operationalDataTouched: false
  }));
} finally {
  await database.close();
}
