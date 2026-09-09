START TRANSACTION;

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('ADMIN_ACCOUNT_SUSPENSION_ACTIVATE','admin_account_suspension','VERIFIED_USER','SHADOW',1,1),
('ADMIN_ACCOUNT_SUSPENSION_RELEASE','admin_account_suspension','VERIFIED_USER','SHADOW',1,1),
('ADMIN_ACCOUNT_SUSPENSION_LIST','admin_account_suspension','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE
  handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text,command_code,active) VALUES
('/계정정지','ADMIN_ACCOUNT_SUSPENSION_ACTIVATE',1),
('/계정정지해제','ADMIN_ACCOUNT_SUSPENSION_RELEASE',1),
('/계정정지리스트','ADMIN_ACCOUNT_SUSPENSION_LIST',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

CREATE TABLE IF NOT EXISTS admin_account_suspension_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  affected_restriction_count INT UNSIGNED NOT NULL DEFAULT 0,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_admin_account_suspension_changes_player (player_id, created_at),
  CONSTRAINT fk_admin_account_suspension_changes_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_account_suspension_changes_player FOREIGN KEY (player_id) REFERENCES players(id)
);

COMMIT;
