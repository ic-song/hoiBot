SET NAMES utf8mb4;
START TRANSACTION;

ALTER TABLE player_title_instances
  ADD COLUMN IF NOT EXISTS title_catalog_entry_id BIGINT UNSIGNED NULL AFTER title_id,
  ADD INDEX IF NOT EXISTS idx_player_title_instance_catalog(title_catalog_entry_id);

INSERT INTO title_definition_catalog_entries(
  catalog_version_id,legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
  definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,metadata_json
)
SELECT version_row.id,definition.id,'RUNTIME_DB','title_definitions',
       CASE WHEN definition.code LIKE 'admin-custom-title:%' THEN 'PLAYER_ADMIN_CUSTOM' ELSE 'PLAYER_GIFT' END,
       definition.code,1,IF(definition.active=1,'ACTIVE','RETIRED'),'PLAYER',definition.display_name,definition.active,
       JSON_OBJECT('migrationCode','403_player_title_definition_instance_link','dynamicNamespace',
         CASE WHEN definition.code LIKE 'admin-custom-title:%' THEN 'ADMIN_CUSTOM' ELSE 'PLAYER_GIFT' END,
         'identityContract','source_scope+stable_code+definition_version+lifecycle')
FROM title_definitions definition
JOIN title_definition_catalog_versions version_row
  ON version_row.catalog_code='TITLE_DEFINITION_SCOPE_LEGACY'
 AND version_row.catalog_version=1
 AND version_row.publish_state='PUBLISHED'
WHERE definition.code LIKE 'admin-custom-title:%'
   OR definition.code LIKE 'player-gift-%'
ON DUPLICATE KEY UPDATE legacy_title_definition_id=VALUES(legacy_title_definition_id);

UPDATE player_title_instances instance_row
JOIN title_definition_catalog_entries catalog_entry
  ON catalog_entry.legacy_title_definition_id=instance_row.title_id
 AND catalog_entry.definition_version=1
SET instance_row.title_catalog_entry_id=catalog_entry.id
WHERE instance_row.title_catalog_entry_id IS NULL;

ALTER TABLE player_title_instances
  ADD CONSTRAINT fk_player_title_instance_catalog
  FOREIGN KEY IF NOT EXISTS (title_catalog_entry_id) REFERENCES title_definition_catalog_entries(id) ON DELETE RESTRICT;

COMMIT;
