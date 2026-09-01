SET NAMES utf8mb4;
START TRANSACTION;

DELETE FROM object_source_bindings
WHERE object_type='ITEM'
  AND source_system='RUNTIME_DB'
  AND source_table='asset_package_reward_target_occurrences'
  AND source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%';

DELETE FROM asset_package_typed_target_catalogs
WHERE catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01';

COMMIT;
