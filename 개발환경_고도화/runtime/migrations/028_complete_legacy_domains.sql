CREATE TABLE attendance_programs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  reset_policy_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_rules_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_program_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_attendance (
  player_id BIGINT UNSIGNED NOT NULL,
  program_id BIGINT UNSIGNED NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attendance_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_attended_at DATETIME(3) NULL,
  light_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_id, program_id, period_key),
  CONSTRAINT fk_player_attendance_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_attendance_program FOREIGN KEY (program_id) REFERENCES attendance_programs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_boards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  channel_id BIGINT UNSIGNED NULL,
  board_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_board_code (code),
  CONSTRAINT fk_community_board_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  board_id BIGINT UNSIGNED NOT NULL,
  author_player_id BIGINT UNSIGNED NOT NULL,
  post_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'message',
  title VARCHAR(500) NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published',
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_community_posts_board_created (board_id, created_at),
  CONSTRAINT fk_community_post_board FOREIGN KEY (board_id) REFERENCES community_boards (id) ON DELETE RESTRICT,
  CONSTRAINT fk_community_post_author FOREIGN KEY (author_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_battle_seasons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  defending_guild_id BIGINT UNSIGNED NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_castle_battle_season_key (season_key),
  CONSTRAINT fk_castle_battle_defender FOREIGN KEY (defending_guild_id) REFERENCES guilds (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_battle_participants (
  season_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  score DECIMAL(30,3) NOT NULL DEFAULT 0,
  rank_no BIGINT UNSIGNED NULL,
  state_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'registered',
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (season_id, guild_id),
  CONSTRAINT fk_castle_participant_season FOREIGN KEY (season_id) REFERENCES castle_battle_seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_participant_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE package_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  price_currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_amount DECIMAL(30,3) NULL,
  purchase_limit BIGINT UNSIGNED NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_package_definition_code (code),
  CONSTRAINT fk_package_price_currency FOREIGN KEY (price_currency_code) REFERENCES currency_definitions (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE package_contents (
  package_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  asset_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_code VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  quantity DECIMAL(30,3) NOT NULL,
  PRIMARY KEY (package_id, sequence_no),
  CONSTRAINT fk_package_content_package FOREIGN KEY (package_id) REFERENCES package_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE package_purchases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  package_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 1,
  purchased_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_package_purchase_operation (operation_id),
  KEY idx_package_purchase_player_time (player_id, purchased_at),
  CONSTRAINT fk_package_purchase_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_package_purchase_package FOREIGN KEY (package_id) REFERENCES package_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_package_purchase_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_expedition_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  duration_seconds BIGINT UNSIGNED NOT NULL,
  requirements_json JSON NULL,
  rewards_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_expedition_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_expedition_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_pet_id BIGINT UNSIGNED NOT NULL,
  expedition_id BIGINT UNSIGNED NOT NULL,
  operation_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at DATETIME(3) NOT NULL,
  completes_at DATETIME(3) NOT NULL,
  claimed_at DATETIME(3) NULL,
  result_json JSON NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_expedition_operation (operation_id),
  KEY idx_pet_expedition_pet_status (player_pet_id, status, completes_at),
  CONSTRAINT fk_pet_expedition_run_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_expedition_run_definition FOREIGN KEY (expedition_id) REFERENCES pet_expedition_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_expedition_run_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_collection_entries (
  player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  discovered_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  first_discovered_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id, mini_pet_definition_id),
  CONSTRAINT fk_mini_pet_collection_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_collection_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_title_assignments (
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  acquired_at DATETIME(3) NULL,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (owned_mini_pet_id, title_id),
  CONSTRAINT fk_mini_pet_title_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_title_definition FOREIGN KEY (title_id) REFERENCES title_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tower_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  season_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'lifetime',
  rules_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tower_definition_code_season (code, season_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_tower_progress (
  tower_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  highest_floor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  current_floor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  attempt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at DATETIME(3) NULL,
  progress_json JSON NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (tower_id, player_id),
  CONSTRAINT fk_tower_progress_tower FOREIGN KEY (tower_id) REFERENCES tower_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tower_progress_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bag_integrity_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  source_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  issue_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  checked_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  detail_json JSON NULL,
  PRIMARY KEY (id),
  KEY idx_bag_integrity_player_time (player_id, checked_at),
  CONSTRAINT fk_bag_integrity_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE request_monitor_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  policy_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_id BIGINT UNSIGNED NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  observation_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  retention_days INT UNSIGNED NULL,
  rule_json JSON NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_monitor_policy_key_channel (policy_key, channel_id),
  CONSTRAINT fk_request_monitor_policy_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
