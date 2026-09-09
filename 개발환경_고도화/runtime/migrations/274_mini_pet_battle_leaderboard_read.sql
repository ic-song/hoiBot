START TRANSACTION;

CREATE TABLE IF NOT EXISTS mini_pet_battle_leaderboard_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  ranking_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  eligible_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_minipet_leaderboard_operation (operation_id),
  CONSTRAINT fk_minipet_leaderboard_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mini_pet_battle_leaderboard_entries (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  ordinal_value INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  mini_pet_name VARCHAR(191) NULL,
  win_count BIGINT UNSIGNED NOT NULL,
  loss_count BIGINT UNSIGNED NOT NULL,
  rounded_win_rate INT UNSIGNED NOT NULL,
  PRIMARY KEY (snapshot_id, ordinal_value),
  UNIQUE KEY uq_minipet_leaderboard_player (snapshot_id, player_id),
  CONSTRAINT fk_minipet_leaderboard_entry_snapshot FOREIGN KEY (snapshot_id) REFERENCES mini_pet_battle_leaderboard_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_leaderboard_entry_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('MINI_PET_BATTLE_RANKING_READ','mini_pet_battle_leaderboard_read','VERIFIED_USER','SHADOW',1,1),
  ('MINI_PET_BATTLE_WIN_RATE_READ','mini_pet_battle_leaderboard_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/미니펫대전순위','MINI_PET_BATTLE_RANKING_READ',1),
  ('/미니펫대전승률','MINI_PET_BATTLE_WIN_RATE_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
