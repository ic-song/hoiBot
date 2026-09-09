CREATE TABLE IF NOT EXISTS player_chat_rank_settings (
  singleton_key TINYINT UNSIGNED NOT NULL,
  source_checkcnt VARCHAR(64) NULL,
  history_since_display VARCHAR(64) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(singleton_key),
  CONSTRAINT chk_player_chat_rank_settings_singleton CHECK(singleton_key=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_chat_rank_snapshots (
  singleton_key TINYINT UNSIGNED NOT NULL,
  top_player_id BIGINT UNSIGNED NOT NULL,
  top_chat_count BIGINT UNSIGNED NOT NULL,
  source_event_id VARCHAR(191) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(singleton_key),
  CONSTRAINT chk_player_chat_rank_snapshot_singleton CHECK(singleton_key=1),
  CONSTRAINT fk_player_chat_rank_top_player FOREIGN KEY(top_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO player_chat_rank_settings(singleton_key,source_checkcnt,history_since_display)
VALUES(1,NULL,'기준일 미이관')
ON DUPLICATE KEY UPDATE singleton_key=VALUES(singleton_key);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PLAYER_CHAT_RANK_READ','player_chat_rank_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/채팅순위','PLAYER_CHAT_RANK_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
