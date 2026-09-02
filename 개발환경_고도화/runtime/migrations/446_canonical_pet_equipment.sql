-- WBS735: legacy bigint/id/code pet and pendant tables are retained; this adds the canonical object-data path.
-- Requires 444_canonical_item_inventory.sql for canonical_players(player_id).
CREATE TABLE canonical_pet_definitions (
  pet_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  pet_description TEXT NULL,
  pet_grade VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL,
  base_charm BIGINT NOT NULL DEFAULT 0,
  charm_per_enhancement BIGINT NOT NULL DEFAULT 0,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_id),
  CONSTRAINT chk_canonical_pet_definitions_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_definitions_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_pet_instances (
  owned_pet_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  custom_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  enhancement_level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  experience_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ownership_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_pet_id),
  UNIQUE KEY uq_canonical_owned_pet_owner (owned_pet_id, player_id),
  KEY idx_canonical_owned_pet_player_status (player_id, ownership_status),
  CONSTRAINT fk_canonical_owned_pet_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_pet_definition FOREIGN KEY (pet_id) REFERENCES canonical_pet_definitions (pet_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_pet_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_pet_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_equipment_definitions (
  equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  equipment_description TEXT NULL,
  equipment_slot VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_grade VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL,
  base_charm BIGINT NOT NULL DEFAULT 0,
  charm_per_enhancement BIGINT NOT NULL DEFAULT 0,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (equipment_id),
  CONSTRAINT chk_canonical_equipment_definitions_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_equipment_definitions_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_equipment_instances (
  owned_equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  custom_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  enhancement_level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  durability_amount BIGINT UNSIGNED NULL,
  ownership_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_equipment_id),
  UNIQUE KEY uq_canonical_owned_equipment_owner (owned_equipment_id, player_id),
  KEY idx_canonical_owned_equipment_player_status (player_id, ownership_status),
  CONSTRAINT fk_canonical_owned_equipment_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_equipment_definition FOREIGN KEY (equipment_id) REFERENCES canonical_equipment_definitions (equipment_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_equipment_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_equipment_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_pet_equipment (
  owned_pet_equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_pet_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_slot VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_pet_equipment_id),
  UNIQUE KEY uq_canonical_owned_pet_equipment_owner (owned_pet_equipment_id, player_id),
  UNIQUE KEY uq_canonical_owned_pet_equipment_instance (owned_equipment_id),
  UNIQUE KEY uq_canonical_owned_pet_equipment_slot (owned_pet_id, equipment_slot),
  CONSTRAINT fk_canonical_owned_pet_equipment_pet FOREIGN KEY (owned_pet_id, player_id) REFERENCES canonical_owned_pet_instances (owned_pet_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_pet_equipment_equipment FOREIGN KEY (owned_equipment_id, player_id) REFERENCES canonical_owned_equipment_instances (owned_equipment_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_pet_equipment_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_pet_equipment_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_pet_equipment_operation_replays (
  pet_equipment_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_pet_equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_equipment_operation_id),
  UNIQUE KEY uq_canonical_pet_equipment_operation_request (player_id, request_key),
  CONSTRAINT fk_canonical_pet_equipment_operation_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_equipment_operation_assignment FOREIGN KEY (owned_pet_equipment_id, player_id) REFERENCES canonical_owned_pet_equipment (owned_pet_equipment_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_pet_equipment_operation_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_equipment_operation_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
