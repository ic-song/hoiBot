CREATE TABLE IF NOT EXISTS admin_dormant_account_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  command_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  level_threshold BIGINT UNSIGNED NOT NULL,
  inactivity_days INT UNSIGNED NOT NULL,
  chat_count_limit BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_count INT UNSIGNED NOT NULL,
  deleted_count INT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_admin_dormant_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_dormant_run_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id),
  CONSTRAINT chk_admin_dormant_run_kind CHECK(command_kind IN('list','delete','usage')),
  CONSTRAINT chk_admin_dormant_run_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_dormant_account_candidates (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  display_name_snapshot VARCHAR(191) NOT NULL,
  level_snapshot BIGINT UNSIGNED NOT NULL,
  chat_count_snapshot BIGINT UNSIGNED NOT NULL,
  last_activity_at_snapshot DATETIME(3) NOT NULL,
  action_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id,sequence_no),
  UNIQUE KEY uq_admin_dormant_candidate(operation_id,player_id),
  CONSTRAINT fk_admin_dormant_candidate_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_dormant_candidate_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT chk_admin_dormant_candidate_action CHECK(action_code IN('listed','deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('ADMIN_DORMANT_ACCOUNT_LIST','admin_dormant_account_delete','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1),
('ADMIN_DORMANT_ACCOUNT_DELETE','admin_dormant_account_delete','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/계정잠수명단','ADMIN_DORMANT_ACCOUNT_LIST',TRUE),
('/계정잠수삭제','ADMIN_DORMANT_ACCOUNT_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
