-- WBS742 Lease2552: migration442 RAW Landing의 식별자·감사 표준을 신규 migration으로 보정합니다.
-- 기존 payload/hash/행은 변경하지 않으며 legacy sequence는 rollback 가능한 교차검증 값으로 보존합니다.

ALTER TABLE data_migration_raw_runs
  ADD COLUMN raw_landing_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER id,
  ADD COLUMN legacy_created_at_utc DATETIME(3) NULL AFTER raw_landing_run_id,
  ADD COLUMN legacy_completed_at_utc DATETIME(3) NULL AFTER legacy_created_at_utc,
  ADD COLUMN raw_landing_completed_time CHAR(19) NULL AFTER run_status,
  ADD COLUMN INSERT_USER VARCHAR(100) NULL AFTER completed_at,
  ADD COLUMN INSERT_TIME CHAR(19) NULL AFTER INSERT_USER,
  ADD COLUMN UPDATE_USER VARCHAR(100) NULL AFTER INSERT_TIME,
  ADD COLUMN UPDATE_TIME CHAR(19) NULL AFTER UPDATE_USER;

ALTER TABLE data_migration_raw_files
  ADD COLUMN raw_landing_file_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL FIRST,
  ADD COLUMN raw_landing_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER run_id,
  ADD COLUMN legacy_imported_at_utc DATETIME(3) NULL AFTER raw_landing_run_id,
  ADD COLUMN INSERT_USER VARCHAR(100) NULL AFTER imported_at,
  ADD COLUMN INSERT_TIME CHAR(19) NULL AFTER INSERT_USER,
  ADD COLUMN UPDATE_USER VARCHAR(100) NULL AFTER INSERT_TIME,
  ADD COLUMN UPDATE_TIME CHAR(19) NULL AFTER UPDATE_USER;

UPDATE data_migration_raw_runs
SET raw_landing_run_id = CONCAT('r', SUBSTRING(SHA2(CONCAT('raw-run:', id, ':', bundle_sha256), 256), 1, 7)),
    legacy_created_at_utc = created_at,
    legacy_completed_at_utc = completed_at,
    raw_landing_completed_time = CASE WHEN completed_at IS NULL THEN NULL ELSE DATE_FORMAT(DATE_ADD(completed_at, INTERVAL 9 HOUR), '%Y-%m-%d %H:%i:%s') END,
    INSERT_USER = 'migration476-backfill',
    INSERT_TIME = DATE_FORMAT(DATE_ADD(created_at, INTERVAL 9 HOUR), '%Y-%m-%d %H:%i:%s'),
    UPDATE_USER = 'migration476-backfill',
    UPDATE_TIME = DATE_FORMAT(DATE_ADD(COALESCE(completed_at, created_at), INTERVAL 9 HOUR), '%Y-%m-%d %H:%i:%s');

UPDATE data_migration_raw_files file_row
JOIN data_migration_raw_runs run_row ON run_row.id = file_row.run_id
SET file_row.raw_landing_file_id = CONCAT('f', SUBSTRING(SHA2(CONCAT('raw-file:', file_row.run_id, ':', file_row.source_path_sha256), 256), 1, 7)),
    file_row.raw_landing_run_id = run_row.raw_landing_run_id,
    file_row.legacy_imported_at_utc = file_row.imported_at,
    file_row.INSERT_USER = 'migration476-backfill',
    file_row.INSERT_TIME = DATE_FORMAT(DATE_ADD(file_row.imported_at, INTERVAL 9 HOUR), '%Y-%m-%d %H:%i:%s'),
    file_row.UPDATE_USER = 'migration476-backfill',
    file_row.UPDATE_TIME = DATE_FORMAT(DATE_ADD(file_row.imported_at, INTERVAL 9 HOUR), '%Y-%m-%d %H:%i:%s');

-- NULL 또는 8자리 hash 충돌이 있으면 scalar subquery가 2행이 되어 DDL 전에 fail closed 합니다.
SELECT (
  SELECT raw_landing_backfill_guard
  FROM (
    SELECT 1 AS raw_landing_backfill_guard
    UNION ALL
    SELECT 2 WHERE EXISTS (
      SELECT 1 FROM data_migration_raw_runs
      WHERE raw_landing_run_id IS NULL OR legacy_created_at_utc IS NULL OR INSERT_TIME IS NULL OR UPDATE_TIME IS NULL
    ) OR EXISTS (
      SELECT raw_landing_run_id FROM data_migration_raw_runs GROUP BY raw_landing_run_id HAVING COUNT(*) > 1
    ) OR EXISTS (
      SELECT 1 FROM data_migration_raw_files
      WHERE raw_landing_file_id IS NULL OR raw_landing_run_id IS NULL OR legacy_imported_at_utc IS NULL OR INSERT_TIME IS NULL OR UPDATE_TIME IS NULL
    ) OR EXISTS (
      SELECT raw_landing_file_id FROM data_migration_raw_files GROUP BY raw_landing_file_id HAVING COUNT(*) > 1
    )
  ) AS raw_landing_backfill_preflight
) AS raw_landing_backfill_guard;

ALTER TABLE data_migration_raw_runs
  ADD UNIQUE KEY uq_data_migration_raw_runs_cuid (raw_landing_run_id);

ALTER TABLE data_migration_raw_files
  DROP FOREIGN KEY fk_data_migration_raw_files_run,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (raw_landing_file_id),
  ADD UNIQUE KEY uq_data_migration_raw_files_source (raw_landing_run_id, source_path_sha256),
  ADD CONSTRAINT fk_data_migration_raw_files_run_cuid FOREIGN KEY (raw_landing_run_id)
    REFERENCES data_migration_raw_runs(raw_landing_run_id) ON DELETE CASCADE;

ALTER TABLE data_migration_raw_runs
  CHANGE COLUMN id legacy_raw_run_sequence BIGINT UNSIGNED NULL,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (raw_landing_run_id),
  ADD UNIQUE KEY uq_data_migration_raw_runs_legacy_sequence (legacy_raw_run_sequence),
  DROP KEY uq_data_migration_raw_runs_cuid;

ALTER TABLE data_migration_raw_files
  DROP COLUMN run_id,
  DROP COLUMN imported_at,
  MODIFY raw_landing_file_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY raw_landing_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY INSERT_USER VARCHAR(100) NOT NULL,
  MODIFY INSERT_TIME CHAR(19) NOT NULL,
  MODIFY UPDATE_USER VARCHAR(100) NOT NULL,
  MODIFY UPDATE_TIME CHAR(19) NOT NULL,
  ADD CONSTRAINT chk_raw_landing_file_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  ADD CONSTRAINT chk_raw_landing_file_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$');

ALTER TABLE data_migration_raw_runs
  DROP COLUMN created_at,
  DROP COLUMN completed_at,
  MODIFY raw_landing_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY INSERT_USER VARCHAR(100) NOT NULL,
  MODIFY INSERT_TIME CHAR(19) NOT NULL,
  MODIFY UPDATE_USER VARCHAR(100) NOT NULL,
  MODIFY UPDATE_TIME CHAR(19) NOT NULL,
  ADD CONSTRAINT chk_raw_landing_run_completed_time CHECK (raw_landing_completed_time IS NULL OR raw_landing_completed_time REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  ADD CONSTRAINT chk_raw_landing_run_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  ADD CONSTRAINT chk_raw_landing_run_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$');
