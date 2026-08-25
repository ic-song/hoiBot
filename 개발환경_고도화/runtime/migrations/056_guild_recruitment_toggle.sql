START TRANSACTION;

CREATE TABLE IF NOT EXISTS guild_join_policies (
  guild_id BIGINT UNSIGNED NOT NULL,
  member_join_closed BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_player_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (guild_id),
  KEY ix_guild_join_policy_open (member_join_closed,guild_id),
  CONSTRAINT fk_guild_join_policy_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_join_policy_actor FOREIGN KEY (updated_by_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO guild_join_policies(guild_id,member_join_closed,version)
SELECT id,member_join_closed,1 FROM guilds
ON DUPLICATE KEY UPDATE member_join_closed=VALUES(member_join_closed);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('GUILD_RECRUITMENT_CLOSE','guild_recruitment_toggle','VERIFIED_USER','SHADOW',1,1),
  ('GUILD_RECRUITMENT_OPEN','guild_recruitment_toggle','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/길드인원마감','GUILD_RECRUITMENT_CLOSE',1),
  ('/길드인원마감해제','GUILD_RECRUITMENT_OPEN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
