SET NAMES utf8mb4;
START TRANSACTION;

DELETE FROM object_source_bindings
WHERE source_system='RUNTIME_DB'
  AND source_table='asset_package_reward_target_occurrences'
  AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%';

DELETE binding_row FROM object_source_bindings binding_row
JOIN object_registry object_row ON object_row.id=binding_row.object_id
WHERE JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.sourceCatalogVersion'))='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01';

DELETE FROM object_registry
WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.sourceCatalogVersion'))='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01';

DELETE FROM item_definitions
WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.migration'))='440_asset_package_data_migration_ready_gap_closure';

DELETE FROM asset_package_typed_target_catalogs
WHERE catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01';

COMMIT;
