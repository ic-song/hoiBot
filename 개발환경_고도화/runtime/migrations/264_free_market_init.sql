CREATE TABLE IF NOT EXISTS market_settings (
  resource_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schema_version INT UNSIGNED NOT NULL,
  initialized_operation_id BIGINT UNSIGNED NOT NULL,
  initialized_by_operator_id BIGINT UNSIGNED NOT NULL,
  metadata_json JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  initialized_at DATETIME(3) NOT NULL,
  PRIMARY KEY(resource_code),
  CONSTRAINT fk_market_settings_operation FOREIGN KEY(initialized_operation_id) REFERENCES operations(id),
  CONSTRAINT fk_market_settings_operator FOREIGN KEY(initialized_by_operator_id) REFERENCES admin_operators(id)
) ENGINE=InnoDB;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MARKET_FREE_MARKET_INIT','free_market_init','TRUSTED_DISPLAY_NAME','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/자유시장생성','MARKET_FREE_MARKET_INIT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
