CREATE TABLE IF NOT EXISTS admin_guild_contribution_count_resets (
  operation_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  counter_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_before BIGINT NOT NULL,
  value_after BIGINT NOT NULL,
  changed BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_admin_guild_contribution_count_reset_target (target_player_id,created_at),
  CONSTRAINT fk_admin_guild_contribution_count_reset_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_guild_contribution_count_reset_player FOREIGN KEY (target_player_id) REFERENCES players(id),
  CONSTRAINT chk_admin_guild_contribution_count_reset_counter CHECK (counter_code='guild_contribution_medal_purchase_count' AND period_key='lifetime'),
  CONSTRAINT chk_admin_guild_contribution_count_reset_after CHECK (value_after=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('guild.contribution_count.reset','공헌훈장 구매횟수 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'guild.contribution_count.reset' FROM admin_roles WHERE code IN ('administrator','super_admin')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_CONTRIBUTION_COUNT_RESET','guild.contribution_count.reset','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/공헌구매초기화','GUILD_CONTRIBUTION_COUNT_RESET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
