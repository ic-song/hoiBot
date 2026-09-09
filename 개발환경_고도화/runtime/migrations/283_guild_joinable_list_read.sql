START TRANSACTION;

CREATE TABLE guild_joinable_list_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  snapshot_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_joinable_snapshot_operation (operation_id),
  UNIQUE KEY uq_guild_joinable_snapshot_token (snapshot_token),
  UNIQUE KEY uq_guild_joinable_snapshot_player_version (player_id,snapshot_version),
  KEY ix_guild_joinable_snapshot_player_expiry (player_id,expires_at,snapshot_version),
  CONSTRAINT fk_guild_joinable_snapshot_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_joinable_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_joinable_list_entries (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  position_no INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  guild_version BIGINT UNSIGNED NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (snapshot_id,position_no),
  UNIQUE KEY uq_guild_joinable_entry_guild (snapshot_id,guild_id),
  CONSTRAINT fk_guild_joinable_entry_snapshot FOREIGN KEY (snapshot_id) REFERENCES guild_joinable_list_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_joinable_entry_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_JOINABLE_LIST_READ','guild_joinable_list_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드목록','GUILD_JOINABLE_LIST_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
