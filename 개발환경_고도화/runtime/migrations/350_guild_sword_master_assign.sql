START TRANSACTION;

INSERT INTO skill_definitions(code,display_name,rules_json,active)
SELECT 'pet_skill_knight_reinforcement','기사단 증원',JSON_OBJECT('guildLeaderOnly',TRUE),TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM skill_definitions WHERE display_name='기사단 증원');

UPDATE skill_definitions
SET rules_json=JSON_SET(COALESCE(rules_json,JSON_OBJECT()),'$.guildLeaderOnly',TRUE),active=TRUE
WHERE display_name='기사단 증원';

CREATE TABLE guild_sword_master_assignment_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  assignment_capacity INT UNSIGNED NOT NULL,
  reinforcement_enabled BOOLEAN NOT NULL,
  member_order_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_selection_json JSON NOT NULL,
  selected_selection_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_guild_sword_master_assignment_guild (guild_id,created_at),
  CONSTRAINT fk_guild_sword_master_assignment_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_sword_master_assignment_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_sword_master_assignment_actor FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_sword_master_assignment_capacity CHECK (assignment_capacity IN (3,4))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_SWORD_MASTER_ASSIGN','guild_sword_master_assign','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/소드마스터','GUILD_SWORD_MASTER_ASSIGN',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
