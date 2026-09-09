CREATE TABLE IF NOT EXISTS admin_account_deletion_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_target_count INT UNSIGNED NOT NULL,
  deleted_target_count INT UNSIGNED NOT NULL,
  failed_target_count INT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_admin_account_deletion_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_account_deletion_run_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id),
  CONSTRAINT chk_admin_account_deletion_run_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_account_deletion_targets (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  requested_name VARCHAR(191) NOT NULL,
  player_id BIGINT UNSIGNED NULL,
  user_account_id BIGINT UNSIGNED NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  anonymized_name VARCHAR(191) NULL,
  removed_guild_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id,sequence_no),
  CONSTRAINT fk_admin_account_deletion_target_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_account_deletion_target_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_admin_account_deletion_target_account FOREIGN KEY(user_account_id) REFERENCES user_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES
('account.delete','계정 삭제 진행')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT IGNORE INTO admin_role_permissions(role_id,permission_code)
SELECT id,'account.delete' FROM admin_roles WHERE code IN ('owner','master','super_admin');

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('ADMIN_ACCOUNT_DELETE_PROGRESS','admin_account_delete_progress','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/계삭진행','ADMIN_ACCOUNT_DELETE_PROGRESS',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
