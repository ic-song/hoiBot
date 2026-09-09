CREATE TABLE IF NOT EXISTS dormant_account_registry (
  player_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  registered_by BIGINT UNSIGNED NOT NULL,
  released_by BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(player_id),
  KEY ix_dormant_registry_status_started(status,started_at,player_id),
  CONSTRAINT fk_dormant_registry_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_dormant_registry_registered_by FOREIGN KEY(registered_by) REFERENCES admin_operators(id),
  CONSTRAINT fk_dormant_registry_released_by FOREIGN KEY(released_by) REFERENCES admin_operators(id),
  CONSTRAINT chk_dormant_registry_status CHECK(status IN('active','released'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dormant_account_registry_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_player_id BIGINT UNSIGNED NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  changed BOOLEAN NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_dormant_registry_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_dormant_registry_run_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id),
  CONSTRAINT fk_dormant_registry_run_target FOREIGN KEY(target_player_id) REFERENCES players(id),
  CONSTRAINT chk_dormant_registry_run_action CHECK(action_code IN('usage','list','register','release'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dormant_account_registry_history (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  next_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at_snapshot DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id,player_id),
  CONSTRAINT fk_dormant_registry_history_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_dormant_registry_history_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT chk_dormant_registry_history_action CHECK(action_code IN('register','release'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('ADMIN_DORMANT_REGISTRY_LIST','admin_dormant_account_registry','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1),
('ADMIN_DORMANT_REGISTRY_REGISTER','admin_dormant_account_registry','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1),
('ADMIN_DORMANT_REGISTRY_RELEASE','admin_dormant_account_registry','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/휴면계정리스트','ADMIN_DORMANT_REGISTRY_LIST',TRUE),
('/휴면계정','ADMIN_DORMANT_REGISTRY_REGISTER',TRUE),
('/휴면해제','ADMIN_DORMANT_REGISTRY_RELEASE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
