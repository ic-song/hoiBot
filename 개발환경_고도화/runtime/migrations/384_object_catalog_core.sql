CREATE TABLE object_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_object_registry_key (object_key),
  UNIQUE KEY uq_object_registry_id_type (id, object_type),
  CONSTRAINT chk_object_registry_key CHECK (
    object_key REGEXP '^[a-z][a-z0-9_]*\\.[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  CONSTRAINT chk_object_registry_type CHECK (
    object_type IN ('ITEM', 'PET', 'FURNITURE', 'TITLE', 'PET_TITLE', 'PACKAGE', 'CURRENCY')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE object_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  object_id BIGINT UNSIGNED NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alias_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alias_value VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_object_alias_scope (object_type, alias_type, alias_value),
  UNIQUE KEY uq_object_alias_owner (object_id, alias_type, alias_value),
  CONSTRAINT fk_object_alias_registry FOREIGN KEY (object_id, object_type)
    REFERENCES object_registry (id, object_type) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE object_source_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  object_id BIGINT UNSIGNED NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_table VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_object_source (source_system, source_table, source_key),
  UNIQUE KEY uq_object_source_owner (object_id, source_system, source_table, source_key),
  CONSTRAINT fk_object_source_registry FOREIGN KEY (object_id, object_type)
    REFERENCES object_registry (id, object_type) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE object_catalog_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_version BIGINT UNSIGNED NULL,
  result_version BIGINT UNSIGNED NOT NULL,
  before_json JSON NULL,
  after_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_object_catalog_operation (operation_id),
  KEY idx_object_catalog_change_object (object_id, id),
  CONSTRAINT fk_object_catalog_change_registry FOREIGN KEY (object_id)
    REFERENCES object_registry (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
