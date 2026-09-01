SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS title_definition_catalog_versions(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version INT UNSIGNED NOT NULL,
  publish_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entry_count INT UNSIGNED NOT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_title_catalog_code_version(catalog_code,catalog_version),
  CONSTRAINT chk_title_catalog_publish_state CHECK(publish_state IN ('DRAFT','PUBLISHED','RETIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS title_definition_catalog_entries(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version_id BIGINT UNSIGNED NOT NULL,
  legacy_title_definition_id BIGINT UNSIGNED NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_table VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_scope VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  stable_code VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  definition_version INT UNSIGNED NOT NULL,
  lifecycle_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  normalized_asset_scope VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  active_snapshot BOOLEAN NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_title_catalog_identity(source_scope,stable_code,definition_version,lifecycle_code),
  UNIQUE KEY uq_title_catalog_legacy(catalog_version_id,legacy_title_definition_id),
  KEY idx_title_catalog_scope(normalized_asset_scope,lifecycle_code),
  CONSTRAINT chk_title_catalog_lifecycle CHECK(lifecycle_code IN ('ACTIVE','RETIRED')),
  CONSTRAINT fk_title_catalog_version FOREIGN KEY(catalog_version_id) REFERENCES title_definition_catalog_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_title_catalog_legacy FOREIGN KEY(legacy_title_definition_id) REFERENCES title_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO title_definition_catalog_versions(catalog_code,catalog_version,publish_state,source_hash,entry_count,published_at)
VALUES('TITLE_DEFINITION_SCOPE_LEGACY',1,'PUBLISHED','4133ec435d454768a6f29b9a7d14a2b309be27e782f86b58ac33cca088ad4fb7',5,UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE id=id;

SET @title_catalog_version_id=(
  SELECT id FROM title_definition_catalog_versions
  WHERE catalog_code='TITLE_DEFINITION_SCOPE_LEGACY' AND catalog_version=1
  LIMIT 1
);

INSERT INTO title_definition_catalog_entries(
  catalog_version_id,legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
  definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,metadata_json
)
SELECT
  @title_catalog_version_id,title_definition.id,'RUNTIME_DB','title_definitions',title_definition.scope_code,title_definition.code,
  1,IF(title_definition.active=1,'ACTIVE','RETIRED'),
  CASE
    WHEN UPPER(REPLACE(title_definition.scope_code,'-','_'))='MINIPET' THEN 'MINI_PET'
    ELSE UPPER(REPLACE(title_definition.scope_code,'-','_'))
  END,
  title_definition.display_name,title_definition.active,
  JSON_OBJECT(
    'legacyTitleDefinitionId',title_definition.id,
    'originalScope',title_definition.scope_code,
    'scopeNormalization','CASE_COMPATIBLE',
    'identityContract','source_scope+stable_code+definition_version+lifecycle'
  )
FROM title_definitions title_definition
ON DUPLICATE KEY UPDATE legacy_title_definition_id=VALUES(legacy_title_definition_id);

COMMIT;
