SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json)
SELECT CONCAT('mini_pet.catalog_',LPAD(binding_row.source_index,4,'0')),
       'MINI_PET',CONCAT(definition_row.display_name,definition_row.emoji_value),1,TRUE,
       JSON_OBJECT(
         'domain','mini_pet_definition',
         'definitionCode',definition_row.code,
         'sourceIndex',binding_row.source_index,
         'sourceKey',binding_row.source_key,
         'compatibilityCode',binding_row.compatibility_code,
         'sourceHash',binding_row.source_hash,
         'grade',definition_row.grade_display_name,
         'emoji',definition_row.emoji_value,
         'catalogVersion','ASSET-FREEZE-v2.400-mini-pet-object-link-01'
       )
FROM mini_pet_definition_source_bindings binding_row
JOIN mini_pet_definitions definition_row ON definition_row.id=binding_row.mini_pet_definition_id
WHERE binding_row.source_system='LEGACY_JSON'
  AND binding_row.source_table='miniPetData.miniPet'
  AND binding_row.catalog_version='ASSET-FREEZE-v2.400-a286279b-01'
ORDER BY binding_row.source_index
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  active=TRUE,
  metadata_json=VALUES(metadata_json);

INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value)
SELECT object_row.id,'MINI_PET','legacy_code',binding_row.compatibility_code
FROM mini_pet_definition_source_bindings binding_row
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('mini_pet.catalog_',LPAD(binding_row.source_index,4,'0'))
 AND object_row.object_type='MINI_PET'
WHERE binding_row.source_system='LEGACY_JSON'
  AND binding_row.source_table='miniPetData.miniPet'
  AND binding_row.catalog_version='ASSET-FREEZE-v2.400-a286279b-01'
ORDER BY binding_row.source_index
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'MINI_PET',binding_row.source_system,binding_row.source_table,binding_row.source_key
FROM mini_pet_definition_source_bindings binding_row
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('mini_pet.catalog_',LPAD(binding_row.source_index,4,'0'))
 AND object_row.object_type='MINI_PET'
WHERE binding_row.source_system='LEGACY_JSON'
  AND binding_row.source_table='miniPetData.miniPet'
  AND binding_row.catalog_version='ASSET-FREEZE-v2.400-a286279b-01'
ORDER BY binding_row.source_index
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

COMMIT;
