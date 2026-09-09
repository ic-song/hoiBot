CREATE TABLE IF NOT EXISTS player_pet_explore_rank_stats (
  player_name VARCHAR(191) NOT NULL,
  win_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lose_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  source_order INT UNSIGNED NOT NULL DEFAULT 0,
  imported_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_name),
  KEY idx_pet_explore_rank (win_count DESC, lose_count ASC, player_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

