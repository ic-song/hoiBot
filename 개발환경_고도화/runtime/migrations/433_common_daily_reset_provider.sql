CREATE TABLE daily_reset_global_locks (
  lock_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (lock_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO daily_reset_global_locks(lock_code,version)
VALUES ('legacy_daily_reset',1)
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

CREATE TABLE daily_reset_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  period_key CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json JSON NULL,
  started_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_reset_run_operation (operation_id),
  UNIQUE KEY uq_daily_reset_run_period (period_key),
  CONSTRAINT fk_daily_reset_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE daily_reset_steps (
  run_id BIGINT UNSIGNED NOT NULL,
  step_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  step_order INT UNSIGNED NOT NULL,
  affected_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  summary_json JSON NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (run_id,step_code),
  UNIQUE KEY uq_daily_reset_step_order (run_id,step_order),
  CONSTRAINT fk_daily_reset_step_run FOREIGN KEY (run_id) REFERENCES daily_reset_runs(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
