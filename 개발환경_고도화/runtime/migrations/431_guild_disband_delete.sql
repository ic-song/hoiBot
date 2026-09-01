CREATE TABLE guild_disband_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  identity_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  guild_code VARCHAR(191) NOT NULL,
  guild_name VARCHAR(191) NOT NULL,
  guild_mark VARCHAR(191) NULL,
  server_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  guild_version_before BIGINT UNSIGNED NOT NULL,
  member_count BIGINT UNSIGNED NOT NULL,
  pending_join_count BIGINT UNSIGNED NOT NULL,
  territory_count BIGINT UNSIGNED NOT NULL,
  castle_released BOOLEAN NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_guild_disband_request (request_key),
  KEY idx_guild_disband_guild_created (guild_id,created_at),
  CONSTRAINT fk_guild_disband_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_disband_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_disband_identity FOREIGN KEY (identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_disband_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_DISBAND_DELETE','guild_disband_delete','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/길드삭제','GUILD_DISBAND_DELETE',TRUE),
  ('/길드해산','GUILD_DISBAND_DELETE',TRUE),
  ('/길드해지','GUILD_DISBAND_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
