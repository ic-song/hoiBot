-- WBS734: legacy bigint/id/code furniture tables are retained for compatibility.
-- New canonical furniture definitions and owned instances use the object-data standard.
CREATE TABLE IF NOT EXISTS object_furniture_players (
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_id),
  CONSTRAINT chk_object_furniture_players_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_object_furniture_players_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS object_furniture_definitions (
  furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  purchase_price BIGINT UNSIGNED NOT NULL DEFAULT 0,
  base_charm BIGINT NOT NULL DEFAULT 0,
  charm_per_enhancement BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (furniture_id),
  CONSTRAINT chk_object_furniture_definitions_price CHECK (purchase_price >= 0),
  CONSTRAINT chk_object_furniture_definitions_enhancement CHECK (charm_per_enhancement >= 0),
  CONSTRAINT chk_object_furniture_definitions_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_object_furniture_definitions_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS object_owned_furniture_instances (
  owned_furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enhancement_level INT UNSIGNED NOT NULL DEFAULT 0,
  ownership_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'bag',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_furniture_id),
  KEY idx_object_owned_furniture_player_status (player_id, ownership_status),
  KEY idx_object_owned_furniture_definition (furniture_id),
  CONSTRAINT fk_object_owned_furniture_player FOREIGN KEY (player_id) REFERENCES object_furniture_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_object_owned_furniture_definition FOREIGN KEY (furniture_id) REFERENCES object_furniture_definitions (furniture_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_owned_furniture_status CHECK (ownership_status IN ('bag','placed','listed','sold','removed')),
  CONSTRAINT chk_object_owned_furniture_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_object_owned_furniture_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS object_home_furniture_placements (
  home_furniture_placement_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  placement_order INT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (home_furniture_placement_id),
  UNIQUE KEY uq_object_home_furniture_placement_owned (owned_furniture_id),
  UNIQUE KEY uq_object_home_furniture_placement_order (player_id, placement_order),
  CONSTRAINT fk_object_home_furniture_placement_player FOREIGN KEY (player_id) REFERENCES object_furniture_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_object_home_furniture_placement_owned FOREIGN KEY (owned_furniture_id) REFERENCES object_owned_furniture_instances (owned_furniture_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_home_furniture_placement_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_object_home_furniture_placement_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS object_furniture_operation_replays (
  furniture_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_scope VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  owned_furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (furniture_operation_id),
  UNIQUE KEY uq_object_furniture_operation_replay (player_id, idempotency_scope, idempotency_key),
  CONSTRAINT fk_object_furniture_operation_player FOREIGN KEY (player_id) REFERENCES object_furniture_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_object_furniture_operation_owned FOREIGN KEY (owned_furniture_id) REFERENCES object_owned_furniture_instances (owned_furniture_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_furniture_operation_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_object_furniture_operation_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
