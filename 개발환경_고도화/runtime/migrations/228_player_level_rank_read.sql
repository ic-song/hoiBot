CREATE TABLE IF NOT EXISTS player_level_rank_snapshots (
  singleton_key TINYINT UNSIGNED NOT NULL,
  top_player_id BIGINT UNSIGNED NOT NULL,
  top_level BIGINT UNSIGNED NOT NULL,
  source_event_id VARCHAR(191) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(singleton_key),
  CONSTRAINT chk_player_level_rank_singleton CHECK(singleton_key=1),
  CONSTRAINT fk_player_level_rank_top_player FOREIGN KEY(top_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PLAYER_LEVEL_RANK_READ','player_level_rank_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/레벨순위','PLAYER_LEVEL_RANK_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
