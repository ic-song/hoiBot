START TRANSACTION;

CREATE TABLE IF NOT EXISTS castle_battle_rank_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id BIGINT UNSIGNED NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  source_version VARCHAR(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_at DATETIME(3) NOT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_castle_rank_snapshot_version (season_id, snapshot_version),
  KEY idx_castle_rank_snapshot_published (season_id, status, published_at),
  CONSTRAINT fk_castle_rank_snapshot_season FOREIGN KEY (season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS castle_battle_rank_snapshot_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NULL,
  stable_tie_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  rank_display INT UNSIGNED NOT NULL,
  tier_display VARCHAR(96) NOT NULL,
  score BIGINT NOT NULL,
  last_battle_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_castle_rank_entry_tie (snapshot_id, stable_tie_key),
  KEY idx_castle_rank_entry_order (snapshot_id, score, last_battle_at, stable_tie_key),
  CONSTRAINT fk_castle_rank_entry_snapshot FOREIGN KEY (snapshot_id) REFERENCES castle_battle_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_rank_entry_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('CASTLE_BATTLE_RANKING_READ','castle_battle_ranking_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/캐슬대전순위','CASTLE_BATTLE_RANKING_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
