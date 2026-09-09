START TRANSACTION;

CREATE TABLE guild_leadership_state (
  guild_id BIGINT UNSIGNED NOT NULL,
  master_player_id BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id),
  UNIQUE KEY uq_guild_leadership_master (master_player_id),
  CONSTRAINT fk_guild_leadership_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_leadership_membership FOREIGN KEY (guild_id,master_player_id) REFERENCES guild_members(guild_id,player_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO guild_leadership_state(guild_id,master_player_id,version)
SELECT member.guild_id,MIN(member.player_id),1
FROM guild_members member
WHERE member.role_code IN ('leader','master')
GROUP BY member.guild_id;

CREATE TABLE guild_role_history (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  previous_role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  change_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,sequence_no),
  KEY ix_guild_role_history_guild_player (guild_id,player_id,created_at),
  CONSTRAINT fk_guild_role_history_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_role_history_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_role_history_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_LEADERSHIP_TRANSFER','guild_leadership_transfer','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드위임','GUILD_LEADERSHIP_TRANSFER',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
