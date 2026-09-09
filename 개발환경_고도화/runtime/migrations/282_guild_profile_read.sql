START TRANSACTION;

ALTER TABLE guild_profile_details
  ADD COLUMN IF NOT EXISTS mark_text VARCHAR(191) NULL AFTER recruitment_closed,
  ADD COLUMN IF NOT EXISTS server_display_name VARCHAR(191) NULL AFTER mark_text,
  ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER server_display_name,
  ADD COLUMN IF NOT EXISTS charm_value BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER tax_rate;

CREATE TABLE guild_member_profile_details (
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  contribution_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id,player_id),
  CONSTRAINT fk_guild_member_profile_membership FOREIGN KEY (guild_id,player_id) REFERENCES guild_members(guild_id,player_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_profile_repair_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NULL,
  profile_rows_created BIGINT UNSIGNED NOT NULL DEFAULT 0,
  resource_rows_created BIGINT UNSIGNED NOT NULL DEFAULT 0,
  member_rows_created BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_guild_profile_repair_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_profile_repair_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_PROFILE_READ','guild_profile_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/길드정보','GUILD_PROFILE_READ',1),
  ('ㄱㄱㄱ','GUILD_PROFILE_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
