START TRANSACTION;
CREATE TABLE player_punch_rank_stats (
 player_id BIGINT UNSIGNED NOT NULL,best_score BIGINT UNSIGNED NOT NULL DEFAULT 0,best_rank VARCHAR(96) NOT NULL DEFAULT '기록없음',
 total_play BIGINT UNSIGNED NOT NULL DEFAULT 0,total_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,legend_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
 last_score BIGINT UNSIGNED NOT NULL DEFAULT 0,last_rank VARCHAR(96) NOT NULL DEFAULT '기록없음',source_order BIGINT UNSIGNED NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),PRIMARY KEY(player_id),
 UNIQUE KEY uq_punch_rank_source_order(source_order),KEY idx_punch_rank_order(best_score,legend_count,total_reward,total_play,source_order),
 CONSTRAINT fk_punch_rank_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('PUNCH_RANK_READ','punch_rank_read','TRUSTED_DISPLAY_NAME','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펀치순위','PUNCH_RANK_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
