CREATE TABLE player_profiles (
  player_id BIGINT UNSIGNED NOT NULL,
  current_display_name VARCHAR(191) NOT NULL,
  joined_at DATETIME(3) NULL,
  level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  accumulated_level_offset BIGINT UNSIGNED NOT NULL DEFAULT 0,
  experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rebirth_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  game_server_id BIGINT UNSIGNED NULL,
  tier_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  terms_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  first_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_player_profiles_name (current_display_name),
  CONSTRAINT fk_player_profile_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_profile_server FOREIGN KEY (game_server_id) REFERENCES game_servers (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_counters (
  player_id BIGINT UNSIGNED NOT NULL,
  counter_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'lifetime',
  value BIGINT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id, counter_code, period_key),
  CONSTRAINT fk_player_counters_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_passes (
  player_id BIGINT UNSIGNED NOT NULL,
  pass_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  permanent BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  PRIMARY KEY (player_id, pass_code),
  CONSTRAINT fk_player_passes_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE currency_definitions (
  code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  scale_digits TINYINT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE currency_accounts (
  player_id BIGINT UNSIGNED NOT NULL,
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  balance DECIMAL(30,3) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id, currency_code),
  CONSTRAINT fk_currency_account_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_currency_account_definition FOREIGN KEY (currency_code) REFERENCES currency_definitions (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE title_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  scope_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_title_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_titles (
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  acquired_at DATETIME(3) NULL,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_id, title_id),
  KEY idx_player_titles_equipped (player_id, equipped),
  CONSTRAINT fk_player_titles_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_titles_title FOREIGN KEY (title_id) REFERENCES title_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_pets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NULL,
  pet_type_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  image_value VARCHAR(500) NULL,
  experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  enhancement_level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_pets_player (player_id),
  CONSTRAINT fk_player_pets_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_titles (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  acquired_at DATETIME(3) NULL,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_pet_id, title_id),
  CONSTRAINT fk_pet_titles_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_titles_title FOREIGN KEY (title_id) REFERENCES title_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE owned_mini_pets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  custom_name VARCHAR(191) NULL,
  progress BIGINT UNSIGNED NOT NULL DEFAULT 0,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  KEY idx_owned_mini_pets_equipped (player_id, equipped),
  CONSTRAINT fk_owned_mini_pets_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_owned_mini_pets_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_homes (
  player_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NULL,
  base_experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  like_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  floor_area BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_id),
  CONSTRAINT fk_player_homes_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE furniture_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  charm_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_furniture_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE owned_furniture (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  furniture_definition_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_owned_furniture_stack (player_id, furniture_definition_id),
  CONSTRAINT fk_owned_furniture_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_owned_furniture_definition FOREIGN KEY (furniture_definition_id) REFERENCES furniture_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE furniture_placements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  owned_furniture_id BIGINT UNSIGNED NOT NULL,
  placement_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_furniture_placement (player_id, placement_key),
  CONSTRAINT fk_furniture_placement_home FOREIGN KEY (player_id) REFERENCES player_homes (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_furniture_placement_owned FOREIGN KEY (owned_furniture_id) REFERENCES owned_furniture (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guilds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guilds_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_members (
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  joined_at DATETIME(3) NULL,
  PRIMARY KEY (guild_id, player_id),
  UNIQUE KEY uq_guild_member_player (player_id),
  CONSTRAINT fk_guild_members_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_members_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leaderboards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'lifetime',
  calculated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leaderboard_code_season (code, season_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leaderboard_entries (
  leaderboard_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  rank_no BIGINT UNSIGNED NOT NULL,
  score DECIMAL(30,3) NOT NULL,
  tie_break_key VARCHAR(500) NULL,
  PRIMARY KEY (leaderboard_id, player_id),
  UNIQUE KEY uq_leaderboard_rank_player (leaderboard_id, rank_no, player_id),
  CONSTRAINT fk_leaderboard_entry_board FOREIGN KEY (leaderboard_id) REFERENCES leaderboards (id) ON DELETE CASCADE,
  CONSTRAINT fk_leaderboard_entry_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_badge_assignments (
  player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  priority INT NOT NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  PRIMARY KEY (player_id, badge_code),
  CONSTRAINT fk_player_badges_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO currency_definitions (code, display_name, scale_digits) VALUES
  ('point', '포인트', 3),
  ('diamond', '다이아', 3)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), scale_digits = VALUES(scale_digits);
