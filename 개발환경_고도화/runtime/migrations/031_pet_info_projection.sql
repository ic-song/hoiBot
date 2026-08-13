ALTER TABLE player_pet_elementals
  ADD COLUMN raid_charm BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER enhancement_level,
  ADD COLUMN castle_charm BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER raid_charm;

ALTER TABLE owned_mini_pets
  ADD COLUMN enhancement_level BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER progress;

CREATE TABLE player_pet_pendants (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_display_name VARCHAR(191) NOT NULL,
  durability BIGINT UNSIGNED NULL,
  max_durability BIGINT UNSIGNED NULL,
  enhancement_level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  raid_charm BIGINT UNSIGNED NOT NULL DEFAULT 0,
  castle_charm BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_pet_id),
  CONSTRAINT fk_player_pet_pendant_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_pet_intimacy (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  intimacy_level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  progress BIGINT UNSIGNED NOT NULL DEFAULT 0,
  charm BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_pet_id),
  CONSTRAINT fk_player_pet_intimacy_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_pet_daily_records (
  player_id BIGINT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  tower_attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tower_floor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  castle_battle_attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  castle_battle_score BIGINT NOT NULL DEFAULT 0,
  castle_rank_label VARCHAR(191) NULL,
  mini_battle_attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mini_battle_wins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mini_battle_losses BIGINT UNSIGNED NOT NULL DEFAULT 0,
  explore_attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  explore_wins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  explore_losses BIGINT UNSIGNED NOT NULL DEFAULT 0,
  daily_quest_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_quest_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pet_home_comment_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  feed_post_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  home_alert_open_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id, record_date),
  CONSTRAINT fk_player_pet_daily_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_home_badge_cubes (
  player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  castle_percent DECIMAL(6,3) NOT NULL DEFAULT 0,
  raid_percent DECIMAL(6,3) NOT NULL DEFAULT 0,
  pet_upgrade_percent DECIMAL(6,3) NOT NULL DEFAULT 0,
  explore_percent DECIMAL(6,3) NOT NULL DEFAULT 0,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id, badge_code),
  KEY idx_home_badge_cube_equipped (player_id, equipped),
  CONSTRAINT fk_player_home_badge_cube_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
