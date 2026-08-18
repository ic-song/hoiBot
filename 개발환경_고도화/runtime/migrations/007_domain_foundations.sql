CREATE TABLE currency_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delta DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_currency_ledger_operation_sequence (operation_id, sequence_no),
  KEY idx_currency_ledger_account_created (player_id, currency_code, created_at),
  CONSTRAINT fk_currency_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_currency_ledger_account FOREIGN KEY (player_id, currency_code) REFERENCES currency_accounts (player_id, currency_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  asset_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stackable BOOLEAN NOT NULL,
  metadata_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_stacks (
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_id, item_id),
  CONSTRAINT fk_inventory_stack_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_stack_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_instances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  attributes_json JSON NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_inventory_instances_owner_item (player_id, item_id, status),
  CONSTRAINT fk_inventory_instance_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_instance_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  instance_id BIGINT UNSIGNED NULL,
  quantity_delta BIGINT NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_ledger_operation_sequence (operation_id, sequence_no),
  CONSTRAINT fk_inventory_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_ledger_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_ledger_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_ledger_instance FOREIGN KEY (instance_id) REFERENCES inventory_instances (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  metadata_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_pet_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE skill_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  rules_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_skill_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_skills (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  slot_no INT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  level BIGINT UNSIGNED NOT NULL DEFAULT 1,
  equipped BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (player_pet_id, slot_no),
  CONSTRAINT fk_pet_skills_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skills_skill FOREIGN KEY (skill_id) REFERENCES skill_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_equipment (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  slot_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (player_pet_id, slot_code),
  UNIQUE KEY uq_pet_equipment_instance (inventory_instance_id),
  CONSTRAINT fk_pet_equipment_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_equipment_instance FOREIGN KEY (inventory_instance_id) REFERENCES inventory_instances (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_roles (
  guild_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  permissions_json JSON NULL,
  PRIMARY KEY (guild_id, code),
  CONSTRAINT fk_guild_roles_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_resource_accounts (
  guild_id BIGINT UNSIGNED NOT NULL,
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  balance DECIMAL(30,3) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, currency_code),
  CONSTRAINT fk_guild_resource_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_resource_currency FOREIGN KEY (currency_code) REFERENCES currency_definitions (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_resource_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delta DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_ledger_operation_sequence (operation_id, sequence_no),
  CONSTRAINT fk_guild_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_ledger_account FOREIGN KEY (guild_id, currency_code) REFERENCES guild_resource_accounts (guild_id, currency_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_warehouse_stacks (
  guild_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, item_id),
  CONSTRAINT fk_guild_warehouse_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_warehouse_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_board_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id BIGINT UNSIGNED NOT NULL,
  author_player_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_guild_board_created (guild_id, created_at),
  CONSTRAINT fk_guild_board_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_board_author FOREIGN KEY (author_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  home_player_id BIGINT UNSIGNED NOT NULL,
  author_player_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'visible',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_home_comments_created (home_player_id, created_at),
  CONSTRAINT fk_home_comments_home FOREIGN KEY (home_player_id) REFERENCES player_homes (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_comments_author FOREIGN KEY (author_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_visits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  home_player_id BIGINT UNSIGNED NOT NULL,
  visitor_player_id BIGINT UNSIGNED NOT NULL,
  visited_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id), KEY idx_home_visits_home_time (home_player_id, visited_at),
  CONSTRAINT fk_home_visits_home FOREIGN KEY (home_player_id) REFERENCES player_homes (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_visits_visitor FOREIGN KEY (visitor_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_reactions (
  home_player_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  reaction_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (home_player_id, actor_player_id, reaction_code),
  CONSTRAINT fk_home_reactions_home FOREIGN KEY (home_player_id) REFERENCES player_homes (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_reactions_actor FOREIGN KEY (actor_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE event_seasons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  starts_at DATETIME(3) NOT NULL, ends_at DATETIME(3) NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uq_event_season_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_mode_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL, rules_json JSON NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_game_mode_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_event_progress (
  season_id BIGINT UNSIGNED NOT NULL, mode_id BIGINT UNSIGNED NOT NULL, player_id BIGINT UNSIGNED NOT NULL,
  progress_json JSON NOT NULL, version BIGINT UNSIGNED NOT NULL DEFAULT 1, updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (season_id, mode_id, player_id),
  CONSTRAINT fk_event_progress_season FOREIGN KEY (season_id) REFERENCES event_seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_progress_mode FOREIGN KEY (mode_id) REFERENCES game_mode_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_progress_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE event_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, operation_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL, mode_id BIGINT UNSIGNED NOT NULL, player_id BIGINT UNSIGNED NOT NULL,
  score DECIMAL(30,3) NOT NULL, result_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_event_result_operation (operation_id),
  CONSTRAINT fk_event_results_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_results_season FOREIGN KEY (season_id) REFERENCES event_seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_results_mode FOREIGN KEY (mode_id) REFERENCES game_mode_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_results_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE boss_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL, stats_json JSON NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_boss_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, seller_player_id BIGINT UNSIGNED NOT NULL,
  asset_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id BIGINT UNSIGNED NULL, inventory_instance_id BIGINT UNSIGNED NULL, quantity BIGINT UNSIGNED NOT NULL DEFAULT 1,
  price_currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, price_amount DECIMAL(30,3) NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'open', version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), expires_at DATETIME(3) NULL, closed_at DATETIME(3) NULL,
  PRIMARY KEY (id), KEY idx_market_listing_status_created (status, created_at),
  CONSTRAINT fk_market_listing_seller FOREIGN KEY (seller_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_instance FOREIGN KEY (inventory_instance_id) REFERENCES inventory_instances (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_currency FOREIGN KEY (price_currency_code) REFERENCES currency_definitions (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_asset_reservations (
  listing_id BIGINT UNSIGNED NOT NULL, reservation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reserved_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (listing_id), UNIQUE KEY uq_market_reservation_key (reservation_key),
  CONSTRAINT fk_market_reservation_listing FOREIGN KEY (listing_id) REFERENCES market_listings (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, operation_id BIGINT UNSIGNED NOT NULL, listing_id BIGINT UNSIGNED NOT NULL,
  buyer_player_id BIGINT UNSIGNED NOT NULL, gross_amount DECIMAL(30,3) NOT NULL, fee_amount DECIMAL(30,3) NOT NULL,
  net_amount DECIMAL(30,3) NOT NULL, settled_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uq_market_settlement_operation (operation_id), UNIQUE KEY uq_market_settlement_listing (listing_id),
  CONSTRAINT fk_market_settlement_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_settlement_listing FOREIGN KEY (listing_id) REFERENCES market_listings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_settlement_buyer FOREIGN KEY (buyer_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, listing_id BIGINT UNSIGNED NOT NULL, operation_id BIGINT UNSIGNED NULL,
  event_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, detail_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), PRIMARY KEY (id),
  KEY idx_market_events_listing_created (listing_id, created_at),
  CONSTRAINT fk_market_events_listing FOREIGN KEY (listing_id) REFERENCES market_listings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_events_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
