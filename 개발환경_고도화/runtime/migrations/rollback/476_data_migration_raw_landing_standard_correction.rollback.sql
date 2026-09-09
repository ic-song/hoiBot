-- 신규 CUID2 행은 legacy sequence가 없어 migration442 shape로 무손실 복귀할 수 없으므로 fail closed 합니다.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2 WHERE EXISTS (
      SELECT 1 FROM data_migration_raw_runs
      WHERE legacy_raw_run_sequence IS NULL
         OR (legacy_raw_run_sequence IS NOT NULL AND legacy_created_at_utc IS NULL)
    ) OR EXISTS (
      SELECT 1
      FROM data_migration_raw_files file_row
      JOIN data_migration_raw_runs run_row ON run_row.raw_landing_run_id = file_row.raw_landing_run_id
      WHERE run_row.legacy_raw_run_sequence IS NOT NULL
        AND file_row.legacy_imported_at_utc IS NULL
    )
  ) AS rollback_preflight
) AS rollback_preflight_guard;

ALTER TABLE data_migration_raw_files
  ADD COLUMN run_id BIGINT UNSIGNED NULL AFTER raw_landing_file_id,
  ADD COLUMN imported_at DATETIME(3) NULL AFTER payload;

UPDATE data_migration_raw_files file_row
JOIN data_migration_raw_runs run_row ON run_row.raw_landing_run_id = file_row.raw_landing_run_id
SET file_row.run_id = run_row.legacy_raw_run_sequence,
    file_row.imported_at = file_row.legacy_imported_at_utc;

ALTER TABLE data_migration_raw_runs
  ADD COLUMN created_at DATETIME(3) NULL AFTER run_status,
  ADD COLUMN completed_at DATETIME(3) NULL AFTER created_at;

UPDATE data_migration_raw_runs
SET created_at = legacy_created_at_utc,
    completed_at = legacy_completed_at_utc;

ALTER TABLE data_migration_raw_files
  DROP FOREIGN KEY fk_data_migration_raw_files_run_cuid,
  DROP PRIMARY KEY,
  DROP KEY uq_data_migration_raw_files_source,
  ADD PRIMARY KEY (run_id, source_path_sha256),
  MODIFY run_id BIGINT UNSIGNED NOT NULL,
  MODIFY imported_at DATETIME(3) NOT NULL;

ALTER TABLE data_migration_raw_runs
  DROP PRIMARY KEY,
  DROP KEY uq_data_migration_raw_runs_legacy_sequence,
  CHANGE COLUMN legacy_raw_run_sequence id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD PRIMARY KEY (id);

ALTER TABLE data_migration_raw_files
  ADD CONSTRAINT fk_data_migration_raw_files_run FOREIGN KEY (run_id)
    REFERENCES data_migration_raw_runs(id) ON DELETE CASCADE,
  DROP CONSTRAINT chk_raw_landing_file_insert_time,
  DROP CONSTRAINT chk_raw_landing_file_update_time,
  DROP COLUMN raw_landing_file_id,
  DROP COLUMN raw_landing_run_id,
  DROP COLUMN legacy_imported_at_utc,
  DROP COLUMN INSERT_USER,
  DROP COLUMN INSERT_TIME,
  DROP COLUMN UPDATE_USER,
  DROP COLUMN UPDATE_TIME;

ALTER TABLE data_migration_raw_runs
  DROP CONSTRAINT chk_raw_landing_run_completed_time,
  DROP CONSTRAINT chk_raw_landing_run_insert_time,
  DROP CONSTRAINT chk_raw_landing_run_update_time,
  DROP COLUMN raw_landing_run_id,
  DROP COLUMN legacy_created_at_utc,
  DROP COLUMN legacy_completed_at_utc,
  DROP COLUMN raw_landing_completed_time,
  DROP COLUMN INSERT_USER,
  DROP COLUMN INSERT_TIME,
  DROP COLUMN UPDATE_USER,
  DROP COLUMN UPDATE_TIME;
