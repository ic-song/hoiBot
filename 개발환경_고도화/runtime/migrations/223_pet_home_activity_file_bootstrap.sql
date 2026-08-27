START TRANSACTION;

CREATE TABLE pet_home_activity_bootstrap_state (
  resource_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schema_version BIGINT UNSIGNED NOT NULL,
  initialized_operation_id BIGINT UNSIGNED NOT NULL,
  initialized_by_operator_id BIGINT UNSIGNED NOT NULL,
  discovered_existing BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_json JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  initialized_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (resource_code),
  CONSTRAINT fk_home_activity_bootstrap_operation FOREIGN KEY (initialized_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_activity_bootstrap_operator FOREIGN KEY (initialized_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_home_activity_bootstrap_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_row_count BIGINT UNSIGNED NOT NULL,
  discovered_existing BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_activity_bootstrap_actor_created (actor_operator_id, created_at),
  CONSTRAINT fk_home_activity_bootstrap_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_activity_bootstrap_run_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_activity_bootstrap_result CHECK (result_code IN ('created','already_exists'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_ACTIVITY_FILE_BOOTSTRAP','home_activity_file_bootstrap','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫홈활동파일생성','HOME_ACTIVITY_FILE_BOOTSTRAP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
