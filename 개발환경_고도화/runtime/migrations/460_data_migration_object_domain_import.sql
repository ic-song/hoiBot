CREATE TABLE IF NOT EXISTS data_migration_object_domain_import_runs (
  object_domain_import_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_projection_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_projection_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  upstream_envelope_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_schema_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_contract_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_source_count INT UNSIGNED NOT NULL,
  projected_source_count INT UNSIGNED NOT NULL,
  quarantined_source_count INT UNSIGNED NOT NULL,
  ignored_source_count INT UNSIGNED NOT NULL,
  expected_row_count INT UNSIGNED NOT NULL,
  imported_row_count INT UNSIGNED NOT NULL,
  run_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (object_domain_import_run_id),
  UNIQUE KEY uq_object_domain_import_projection (catalog_projection_run_id, catalog_version, import_contract_sha256),
  CONSTRAINT fk_object_domain_import_projection FOREIGN KEY (catalog_projection_run_id)
    REFERENCES data_migration_catalog_projection_runs(catalog_projection_run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_domain_import_status CHECK (run_status IN ('IMPORTING','COMPLETE')),
  CONSTRAINT chk_object_domain_import_projection_hash CHECK (catalog_projection_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_upstream_hash CHECK (upstream_envelope_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_schema_hash CHECK (target_schema_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_contract_hash CHECK (import_contract_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_hash CHECK (import_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_source_counts CHECK (projected_source_count + quarantined_source_count + ignored_source_count = expected_source_count),
  CONSTRAINT chk_object_domain_import_row_counts CHECK (imported_row_count <= expected_row_count),
  CONSTRAINT chk_object_domain_import_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  CONSTRAINT chk_object_domain_import_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_migration_object_domain_import_decisions (
  object_domain_import_decision_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_domain_import_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_source_decision_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_locator_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision_reason VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  projected_row_count INT UNSIGNED NOT NULL,
  decision_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (object_domain_import_decision_id),
  UNIQUE KEY uq_object_domain_import_decision (object_domain_import_run_id, catalog_source_decision_id),
  CONSTRAINT fk_object_domain_import_decision_run FOREIGN KEY (object_domain_import_run_id)
    REFERENCES data_migration_object_domain_import_runs(object_domain_import_run_id) ON DELETE CASCADE,
  CONSTRAINT fk_object_domain_import_catalog_decision FOREIGN KEY (catalog_source_decision_id)
    REFERENCES data_migration_catalog_source_decisions(catalog_source_decision_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_domain_import_decision_status CHECK (
    (decision_status = 'PROJECT' AND decision_reason IS NULL AND projected_row_count > 0) OR
    (decision_status IN ('QUARANTINE','IGNORE') AND decision_reason IS NOT NULL AND projected_row_count = 0)
  ),
  CONSTRAINT chk_object_domain_import_decision_locator CHECK (source_locator_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_decision_hash CHECK (decision_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_decision_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  CONSTRAINT chk_object_domain_import_decision_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_migration_object_domain_import_records (
  object_domain_import_record_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_domain_import_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_projection_record_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_table_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_pk_column_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_pk_value CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_locator_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_order INT UNSIGNED NOT NULL,
  binding_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  imported_row_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (object_domain_import_record_id),
  UNIQUE KEY uq_object_domain_import_record (object_domain_import_run_id, catalog_projection_record_id),
  UNIQUE KEY uq_object_domain_import_order (object_domain_import_run_id, import_order),
  UNIQUE KEY uq_object_domain_import_target (object_domain_import_run_id, target_table_name, target_pk_value),
  CONSTRAINT fk_object_domain_import_record_run FOREIGN KEY (object_domain_import_run_id)
    REFERENCES data_migration_object_domain_import_runs(object_domain_import_run_id) ON DELETE CASCADE,
  CONSTRAINT fk_object_domain_import_catalog_record FOREIGN KEY (catalog_projection_record_id)
    REFERENCES data_migration_catalog_projection_records(catalog_projection_record_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_domain_import_record_locator CHECK (identity_locator_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_binding_hash CHECK (binding_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_row_hash CHECK (imported_row_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_object_domain_import_record_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  CONSTRAINT chk_object_domain_import_record_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
