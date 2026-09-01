SET NAMES utf8mb4;
START TRANSACTION;

DELETE occurrence
FROM mini_pet_collection_reward_occurrences occurrence
JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01';

DELETE FROM mini_pet_collection_reward_catalogs
WHERE catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01';

DELETE source_binding
FROM object_source_bindings source_binding
JOIN object_registry object_row ON object_row.id=source_binding.object_id
WHERE source_binding.object_type='TITLE'
  AND source_binding.source_system='LEGACY_JSON'
  AND source_binding.source_table='data/miniPetCollectionInfo.json#titles'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01';

DELETE FROM object_registry
WHERE object_type='TITLE'
  AND object_key LIKE 'title.mini_pet_collection.stage_%.v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01';

COMMIT;
