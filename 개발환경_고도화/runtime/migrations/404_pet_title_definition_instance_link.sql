SET NAMES utf8mb4;
START TRANSACTION;

ALTER TABLE player_pet_title_instances
  ADD COLUMN IF NOT EXISTS legacy_title_definition_id BIGINT UNSIGNED NULL AFTER title_key,
  ADD COLUMN IF NOT EXISTS title_catalog_entry_id BIGINT UNSIGNED NULL AFTER legacy_title_definition_id,
  ADD INDEX IF NOT EXISTS idx_pet_title_instance_definition(legacy_title_definition_id),
  ADD INDEX IF NOT EXISTS idx_pet_title_instance_catalog(title_catalog_entry_id);

CREATE TEMPORARY TABLE migration404_pet_title_sources(
  instance_id BIGINT UNSIGNED NOT NULL,
  source_scope VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(instance_id)
) ENGINE=InnoDB;

INSERT INTO migration404_pet_title_sources(instance_id,source_scope)
SELECT instance_row.id,'PET_ADMIN_CUSTOM'
FROM player_pet_title_instances instance_row
JOIN command_audit audit_row
  ON audit_row.action_code='pet_title.add'
 AND JSON_UNQUOTE(JSON_EXTRACT(audit_row.change_summary_json,'$.instanceKey'))=instance_row.instance_key
ON DUPLICATE KEY UPDATE source_scope=VALUES(source_scope);

INSERT INTO migration404_pet_title_sources(instance_id,source_scope)
SELECT instance_row.id,'PET_USER_CUSTOM'
FROM player_pet_title_instances instance_row
JOIN command_audit audit_row
  ON audit_row.action_code='pet_title.lifecycle'
 AND JSON_UNQUOTE(JSON_EXTRACT(audit_row.change_summary_json,'$.kind'))='create'
 AND CAST(JSON_UNQUOTE(JSON_EXTRACT(audit_row.change_summary_json,'$.instanceId')) AS UNSIGNED)=instance_row.id
ON DUPLICATE KEY UPDATE source_scope=VALUES(source_scope);

INSERT INTO title_definitions(code,display_name,scope_code,active)
SELECT DISTINCT CONCAT(CONVERT(source_row.source_scope USING utf8mb4),'_',SHA2(instance_row.display_name,256)),instance_row.display_name,
       LOWER(source_row.source_scope),TRUE
FROM migration404_pet_title_sources source_row
JOIN player_pet_title_instances instance_row ON instance_row.id=source_row.instance_id
ON DUPLICATE KEY UPDATE active=TRUE;

INSERT INTO title_definition_catalog_entries(
  catalog_version_id,legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
  definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,metadata_json
)
SELECT version_row.id,definition.id,'RUNTIME_DB','title_definitions',source_row.source_scope,
       CONCAT(CONVERT(source_row.source_scope USING utf8mb4),':',SHA2(instance_row.display_name,256)),1,'ACTIVE','PET',instance_row.display_name,TRUE,
       JSON_OBJECT('migrationCode','404_pet_title_definition_instance_link','dynamicNamespace',source_row.source_scope,
         'legacyInstanceTitleKey',instance_row.title_key,
         'identityContract','source_scope+stable_code+definition_version+lifecycle')
FROM migration404_pet_title_sources source_row
JOIN player_pet_title_instances instance_row ON instance_row.id=source_row.instance_id
JOIN title_definitions definition
  ON CONVERT(definition.code USING utf8mb4)=CONCAT(CONVERT(source_row.source_scope USING utf8mb4),'_',SHA2(instance_row.display_name,256))
JOIN title_definition_catalog_versions version_row
  ON version_row.catalog_code='TITLE_DEFINITION_SCOPE_LEGACY'
 AND version_row.catalog_version=1 AND version_row.publish_state='PUBLISHED'
ON DUPLICATE KEY UPDATE legacy_title_definition_id=VALUES(legacy_title_definition_id);

UPDATE player_pet_title_instances instance_row
JOIN migration404_pet_title_sources source_row ON source_row.instance_id=instance_row.id
JOIN title_definition_catalog_entries catalog_entry
  ON BINARY catalog_entry.source_scope=BINARY source_row.source_scope
 AND catalog_entry.stable_code=CONCAT(CONVERT(source_row.source_scope USING utf8mb4),':',SHA2(instance_row.display_name,256))
 AND catalog_entry.definition_version=1 AND catalog_entry.lifecycle_code='ACTIVE'
SET instance_row.legacy_title_definition_id=catalog_entry.legacy_title_definition_id,
    instance_row.title_catalog_entry_id=catalog_entry.id;

ALTER TABLE player_pet_title_instances
  ADD CONSTRAINT fk_pet_title_instance_definition
  FOREIGN KEY IF NOT EXISTS (legacy_title_definition_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pet_title_instance_catalog
  FOREIGN KEY IF NOT EXISTS (title_catalog_entry_id) REFERENCES title_definition_catalog_entries(id) ON DELETE RESTRICT;

DROP TEMPORARY TABLE migration404_pet_title_sources;
COMMIT;
