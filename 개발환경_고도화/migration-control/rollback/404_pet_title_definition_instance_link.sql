START TRANSACTION;

ALTER TABLE player_pet_title_instances
  DROP FOREIGN KEY IF EXISTS fk_pet_title_instance_catalog,
  DROP FOREIGN KEY IF EXISTS fk_pet_title_instance_definition,
  DROP INDEX IF EXISTS idx_pet_title_instance_catalog,
  DROP INDEX IF EXISTS idx_pet_title_instance_definition,
  DROP COLUMN IF EXISTS title_catalog_entry_id,
  DROP COLUMN IF EXISTS legacy_title_definition_id;

DELETE FROM title_definition_catalog_entries
WHERE source_system='RUNTIME_DB' AND source_table='title_definitions'
  AND source_scope IN ('PET_ADMIN_CUSTOM','PET_USER_CUSTOM') AND definition_version=1;

DELETE definition FROM title_definitions definition
LEFT JOIN pet_titles projection ON projection.title_id=definition.id
LEFT JOIN title_definition_catalog_entries catalog_entry ON catalog_entry.legacy_title_definition_id=definition.id
WHERE (definition.code LIKE 'PET_ADMIN_CUSTOM\_%' ESCAPE '\\' OR definition.code LIKE 'PET_USER_CUSTOM\_%' ESCAPE '\\')
  AND projection.title_id IS NULL AND catalog_entry.id IS NULL;

COMMIT;
