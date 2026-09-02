-- WBS738: canonical pet skill definition, quantity ownership, pet equipment, and replay boundary.
-- Integration dependencies: 444_canonical_item_inventory.sql (canonical_players) and
-- 446_canonical_pet_equipment.sql (canonical_owned_pet_instances).
CREATE TABLE canonical_pet_skill_definitions (
  pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  pet_skill_description TEXT NULL,
  pet_skill_grade VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL,
  handler_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  options_json JSON NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_skill_id),
  CONSTRAINT chk_canonical_pet_skill_handler CHECK (handler_key IN ('passive_modifier','command_unlock','presentation_only')),
  CONSTRAINT chk_canonical_pet_skill_options CHECK (JSON_VALID(options_json)),
  CONSTRAINT chk_canonical_pet_skill_definitions_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_skill_definitions_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_pet_skill_definition_imports (
  pet_skill_definition_import_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_skill_definition_import_id),
  UNIQUE KEY uq_canonical_pet_skill_import_source (source_system, source_namespace, source_identifier),
  CONSTRAINT fk_canonical_pet_skill_import_definition FOREIGN KEY (pet_skill_id) REFERENCES canonical_pet_skill_definitions (pet_skill_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_pet_skill_imports_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_skill_imports_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_pet_skill_stacks (
  owned_pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_pet_skill_id),
  UNIQUE KEY uq_canonical_owned_pet_skill_stack (player_id, pet_skill_id),
  CONSTRAINT fk_canonical_owned_pet_skill_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_pet_skill_definition FOREIGN KEY (pet_skill_id) REFERENCES canonical_pet_skill_definitions (pet_skill_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_pet_skill_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_pet_skill_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_pet_skill_equipments (
  owned_pet_skill_equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_pet_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_number INT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_pet_skill_equipment_id),
  UNIQUE KEY uq_canonical_pet_skill_equipment_owner (owned_pet_skill_equipment_id, player_id),
  UNIQUE KEY uq_canonical_pet_skill_equipment_slot (owned_pet_id, slot_number),
  UNIQUE KEY uq_canonical_pet_skill_equipment_skill (owned_pet_id, pet_skill_id),
  CONSTRAINT fk_canonical_pet_skill_equipment_pet FOREIGN KEY (owned_pet_id, player_id) REFERENCES canonical_owned_pet_instances (owned_pet_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_skill_equipment_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_skill_equipment_definition FOREIGN KEY (pet_skill_id) REFERENCES canonical_pet_skill_definitions (pet_skill_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_pet_skill_equipment_slot CHECK (slot_number BETWEEN 1 AND 30),
  CONSTRAINT chk_canonical_pet_skill_equipments_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_skill_equipments_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_pet_skill_operation_replays (
  pet_skill_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation_kind VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_pet_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  owned_pet_skill_equipment_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resulting_quantity BIGINT UNSIGNED NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_skill_operation_id),
  UNIQUE KEY uq_canonical_pet_skill_operation_request (player_id, request_key),
  CONSTRAINT fk_canonical_pet_skill_operation_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_skill_operation_definition FOREIGN KEY (pet_skill_id) REFERENCES canonical_pet_skill_definitions (pet_skill_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_skill_operation_pet FOREIGN KEY (owned_pet_id, player_id) REFERENCES canonical_owned_pet_instances (owned_pet_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_skill_operation_equipment FOREIGN KEY (owned_pet_skill_equipment_id, player_id) REFERENCES canonical_owned_pet_skill_equipments (owned_pet_skill_equipment_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_pet_skill_operation_kind CHECK (operation_kind IN ('grant','equip')),
  CONSTRAINT chk_canonical_pet_skill_operation_status CHECK (operation_status = 'completed'),
  CONSTRAINT chk_canonical_pet_skill_operations_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_skill_operations_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
