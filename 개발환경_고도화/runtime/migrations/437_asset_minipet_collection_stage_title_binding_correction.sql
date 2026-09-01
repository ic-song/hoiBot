SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_m437_stage_title_identity AS
SELECT
  definition_row.id AS title_definition_id,
  catalog_entry.stable_code AS definition_code,
  catalog_entry.display_name,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(catalog_entry.metadata_json,'$.sourceRow')) AS UNSIGNED) AS source_row,
  CONCAT(
    'title.mini_pet_collection.stage_',
    LPAD(CAST(JSON_UNQUOTE(JSON_EXTRACT(catalog_entry.metadata_json,'$.sourceRow')) AS UNSIGNED),3,'0'),
    '.v1'
  ) AS object_key
FROM title_definition_catalog_entries catalog_entry
JOIN title_definitions definition_row
  ON definition_row.id=catalog_entry.legacy_title_definition_id
 AND definition_row.code=catalog_entry.stable_code
 AND definition_row.scope_code='mini_pet_collection'
 AND definition_row.active=TRUE
WHERE catalog_entry.source_scope='MINI_PET_COLLECTION'
  AND catalog_entry.definition_version=1
  AND catalog_entry.lifecycle_code='ACTIVE'
  AND JSON_UNQUOTE(JSON_EXTRACT(catalog_entry.metadata_json,'$.sourceFile'))='data/miniPetCollectionInfo.json'
  AND JSON_UNQUOTE(JSON_EXTRACT(catalog_entry.metadata_json,'$.sourceSection'))='titles';

CREATE TEMPORARY TABLE tmp_m437_identity_guard(
  row_count INT UNSIGNED NOT NULL,
  source_row_count INT UNSIGNED NOT NULL,
  definition_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_m437_identity_count CHECK(row_count=100 AND source_row_count=100 AND definition_count=100)
) ENGINE=InnoDB;
INSERT INTO tmp_m437_identity_guard
SELECT COUNT(*),COUNT(DISTINCT source_row),COUNT(DISTINCT definition_code)
FROM tmp_m437_stage_title_identity;

INSERT INTO object_registry
  (object_key,object_type,display_name,version,active,metadata_json)
SELECT
  identity_row.object_key,
  'TITLE',
  identity_row.display_name,
  1,
  TRUE,
  JSON_OBJECT(
    'domain','mini_pet_collection_stage_title',
    'definitionCode',identity_row.definition_code,
    'definitionBinding',CONCAT('RUNTIME_DB|title_definitions|',identity_row.definition_code),
    'sourceScope','STAGE',
    'sourceRow',identity_row.source_row,
    'catalogVersion','ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01',
    'sourceHash','3dadafd107bb82480d6d5218f98af2a31d0037af7c15b5fecaf8d3c62b9a4e39',
    'identityContract','source_file+source_section+source_row+definition_code'
  )
FROM tmp_m437_stage_title_identity identity_row
ORDER BY identity_row.source_row
ON DUPLICATE KEY UPDATE
  object_key=IF(
    object_registry.object_type=VALUES(object_type)
    AND BINARY object_registry.display_name=BINARY VALUES(display_name)
    AND JSON_UNQUOTE(JSON_EXTRACT(object_registry.metadata_json,'$.definitionCode'))=JSON_UNQUOTE(JSON_EXTRACT(VALUES(metadata_json),'$.definitionCode'))
    AND CAST(JSON_UNQUOTE(JSON_EXTRACT(object_registry.metadata_json,'$.sourceRow')) AS UNSIGNED)=CAST(JSON_UNQUOTE(JSON_EXTRACT(VALUES(metadata_json),'$.sourceRow')) AS UNSIGNED),
    object_registry.object_key,
    NULL
  );

INSERT INTO object_source_bindings
  (object_id,object_type,source_system,source_table,source_key)
SELECT
  object_row.id,
  'TITLE',
  'LEGACY_JSON',
  'data/miniPetCollectionInfo.json#titles',
  CAST(identity_row.source_row AS CHAR)
FROM tmp_m437_stage_title_identity identity_row
JOIN object_registry object_row
  ON object_row.object_key=identity_row.object_key
 AND object_row.object_type='TITLE'
ORDER BY identity_row.source_row
ON DUPLICATE KEY UPDATE
  object_id=IF(
    object_source_bindings.object_id=VALUES(object_id)
    AND object_source_bindings.object_type=VALUES(object_type),
    object_source_bindings.object_id,
    NULL
  );

INSERT INTO mini_pet_collection_reward_catalogs
  (catalog_version,source_system,source_path,source_sha256,grade_reward_count,stage_reward_count,title_definition_count,
   reward_item_id,reward_item_object_id,reward_item_code,reward_item_object_key,reward_item_display_name,ownership_model,publication_status)
SELECT
  'ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01',
  source_system,source_path,source_sha256,grade_reward_count,stage_reward_count,title_definition_count,
  reward_item_id,reward_item_object_id,reward_item_code,reward_item_object_key,reward_item_display_name,ownership_model,'SHADOW'
FROM mini_pet_collection_reward_catalogs
WHERE catalog_version='ASSET-FREEZE-v2.435-mini-pet-collection-reward-01'
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

INSERT INTO mini_pet_collection_reward_occurrences
  (reward_catalog_id,global_source_order,source_scope,source_key,source_order,raw_item_display_name,quantity,
   title_display_name,title_price,canonical_title_id,title_resolution,display_identity_hash,source_row_hash)
SELECT
  target_catalog.id,
  source_occurrence.global_source_order,
  source_occurrence.source_scope,
  source_occurrence.source_key,
  source_occurrence.source_order,
  source_occurrence.raw_item_display_name,
  source_occurrence.quantity,
  source_occurrence.title_display_name,
  source_occurrence.title_price,
  CASE WHEN source_occurrence.source_scope='STAGE' THEN identity_row.title_definition_id ELSE NULL END,
  CASE WHEN source_occurrence.source_scope='STAGE' THEN 'RESOLVED' ELSE 'NOT_APPLICABLE' END,
  source_occurrence.display_identity_hash,
  source_occurrence.source_row_hash
FROM mini_pet_collection_reward_catalogs source_catalog
JOIN mini_pet_collection_reward_occurrences source_occurrence
  ON source_occurrence.reward_catalog_id=source_catalog.id
JOIN mini_pet_collection_reward_catalogs target_catalog
  ON target_catalog.catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01'
LEFT JOIN object_source_bindings source_binding
  ON source_occurrence.source_scope='STAGE'
 AND source_binding.source_system='LEGACY_JSON'
 AND source_binding.source_table='data/miniPetCollectionInfo.json#titles'
 AND source_binding.source_key=source_occurrence.source_key
LEFT JOIN object_registry title_object
  ON title_object.id=source_binding.object_id
 AND title_object.object_type='TITLE'
LEFT JOIN tmp_m437_stage_title_identity identity_row
  ON identity_row.object_key=title_object.object_key
 AND identity_row.definition_code=JSON_UNQUOTE(JSON_EXTRACT(title_object.metadata_json,'$.definitionCode'))
 AND identity_row.source_row=CAST(source_occurrence.source_key AS UNSIGNED)
 AND BINARY identity_row.display_name=BINARY source_occurrence.title_display_name
WHERE source_catalog.catalog_version='ASSET-FREEZE-v2.435-mini-pet-collection-reward-01'
  AND (source_occurrence.source_scope='GRADE' OR identity_row.title_definition_id IS NOT NULL)
ORDER BY source_occurrence.global_source_order
ON DUPLICATE KEY UPDATE global_source_order=VALUES(global_source_order);

CREATE TEMPORARY TABLE tmp_m437_result_guard(
  object_count INT UNSIGNED NOT NULL,
  binding_count INT UNSIGNED NOT NULL,
  old_occurrence_count INT UNSIGNED NOT NULL,
  old_unresolved_count INT UNSIGNED NOT NULL,
  new_occurrence_count INT UNSIGNED NOT NULL,
  new_resolved_count INT UNSIGNED NOT NULL,
  new_not_applicable_count INT UNSIGNED NOT NULL,
  new_unresolved_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_m437_result_count CHECK(
    object_count=100 AND binding_count=100
    AND old_occurrence_count=108 AND old_unresolved_count=100
    AND new_occurrence_count=108 AND new_resolved_count=100 AND new_not_applicable_count=8 AND new_unresolved_count=0
  )
) ENGINE=InnoDB;
INSERT INTO tmp_m437_result_guard
SELECT
  (SELECT COUNT(*) FROM object_registry WHERE object_type='TITLE' AND object_key LIKE 'title.mini_pet_collection.stage_%.v1'
    AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01'),
  (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='TITLE' AND source_system='LEGACY_JSON'
    AND source_table='data/miniPetCollectionInfo.json#titles'),
  (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.435-mini-pet-collection-reward-01'),
  (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.435-mini-pet-collection-reward-01' AND occurrence.title_resolution='UNRESOLVED'),
  (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01'),
  (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01' AND occurrence.title_resolution='RESOLVED'),
  (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01' AND occurrence.title_resolution='NOT_APPLICABLE'),
  (SELECT COUNT(*) FROM mini_pet_collection_reward_occurrences occurrence JOIN mini_pet_collection_reward_catalogs catalog ON catalog.id=occurrence.reward_catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01' AND occurrence.title_resolution IN ('UNRESOLVED','CONFLICT'));

DROP TEMPORARY TABLE tmp_m437_result_guard;
DROP TEMPORARY TABLE tmp_m437_identity_guard;
DROP TEMPORARY TABLE tmp_m437_stage_title_identity;
COMMIT;
