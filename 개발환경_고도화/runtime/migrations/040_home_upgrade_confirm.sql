CREATE TABLE home_upgrade_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  floor_area BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  experience_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_home_upgrade_definition_floor (floor_area)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_upgrade_requirements (
  definition_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (definition_id, item_id),
  CONSTRAINT fk_home_upgrade_requirement_definition FOREIGN KEY (definition_id) REFERENCES home_upgrade_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_upgrade_requirement_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_upgrade_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  definition_id BIGINT UNSIGNED NOT NULL,
  definition_version BIGINT UNSIGNED NOT NULL,
  required_snapshot_json JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_home_upgrade_confirmation_player (player_id),
  KEY idx_home_upgrade_confirmation_expiry (status, expires_at),
  CONSTRAINT fk_home_upgrade_confirmation_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_upgrade_confirmation_definition FOREIGN KEY (definition_id) REFERENCES home_upgrade_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
