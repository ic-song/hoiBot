START TRANSACTION;

ALTER TABLE player_title_instances
  DROP FOREIGN KEY IF EXISTS fk_player_title_instance_catalog,
  DROP INDEX IF EXISTS idx_player_title_instance_catalog,
  DROP COLUMN IF EXISTS title_catalog_entry_id;

DELETE FROM title_definition_catalog_entries
WHERE source_system='RUNTIME_DB'
  AND source_table='title_definitions'
  AND source_scope IN ('PLAYER_ADMIN_CUSTOM','PLAYER_GIFT')
  AND definition_version=1;

COMMIT;
