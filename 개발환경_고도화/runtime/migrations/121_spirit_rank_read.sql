START TRANSACTION;
CREATE TABLE player_legacy_rank_profiles (
 player_id BIGINT UNSIGNED NOT NULL,
 rank_emoji VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
 source_order BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(player_id), UNIQUE KEY uq_player_legacy_rank_source_order(source_order),
 CONSTRAINT fk_player_legacy_rank_profile_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('SPIRIT_RANK_READ','spirit_rank_read','TRUSTED_DISPLAY_NAME','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/정령순위','SPIRIT_RANK_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
