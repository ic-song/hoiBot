CREATE TABLE IF NOT EXISTS data_migration_raw_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_key CHAR(64) NOT NULL,
  snapshot_manifest_sha256 CHAR(64) NOT NULL,
  bundle_sha256 CHAR(64) NOT NULL,
  expected_file_count INT UNSIGNED NOT NULL,
  expected_total_bytes BIGINT UNSIGNED NOT NULL,
  run_status VARCHAR(16) NOT NULL DEFAULT 'LOADING',
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_data_migration_raw_runs_key (run_key),
  CONSTRAINT chk_data_migration_raw_runs_status CHECK (run_status IN ('LOADING','COMPLETE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_migration_raw_files (
  run_id BIGINT UNSIGNED NOT NULL,
  source_path_sha256 CHAR(64) NOT NULL,
  source_content_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  payload LONGBLOB NOT NULL,
  imported_at DATETIME(3) NOT NULL,
  PRIMARY KEY (run_id, source_path_sha256),
  CONSTRAINT fk_data_migration_raw_files_run FOREIGN KEY (run_id)
    REFERENCES data_migration_raw_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
