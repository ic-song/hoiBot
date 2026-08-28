START TRANSACTION;

ALTER TABLE guild_profile_details
  ADD COLUMN IF NOT EXISTS notice_text VARCHAR(30) NULL AFTER recruitment_closed;

CREATE TABLE guild_profile_notice_history (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  previous_notice_text VARCHAR(30) NULL,
  notice_text VARCHAR(30) NOT NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  resulting_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_guild_profile_notice_history_guild (guild_id,created_at),
  CONSTRAINT fk_guild_profile_notice_history_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_profile_notice_history_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_profile_notice_history_actor FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_PROFILE_NOTICE_MUTATE','guild_profile_notice_mutate','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드공지','GUILD_PROFILE_NOTICE_MUTATE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
