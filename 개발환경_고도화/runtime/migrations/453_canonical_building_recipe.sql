-- WBS741: canonical building definitions and generic typed craft recipe execution.
-- Integration dependencies: 444_canonical_item_inventory.sql and 452_canonical_currency_ledger.sql.
ALTER TABLE canonical_owned_item_stacks
  ADD UNIQUE KEY uq_canonical_owned_item_stack_owner_target (owned_item_stack_id, player_id, item_id);

CREATE TABLE canonical_building_definitions (
  building_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  building_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  floor_value INT UNSIGNED NOT NULL,
  experience_required BIGINT UNSIGNED NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (building_id),
  CONSTRAINT chk_canonical_building_floor CHECK (floor_value > 0),
  CONSTRAINT chk_canonical_building_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_building_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_building_definition_imports (
  building_definition_import_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  building_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (building_definition_import_id),
  UNIQUE KEY uq_canonical_building_import_source (source_system, source_namespace, source_identifier),
  CONSTRAINT fk_canonical_building_import_definition FOREIGN KEY (building_id) REFERENCES canonical_building_definitions (building_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_building_import_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_building_import_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_recipe_definitions (
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  craft_recipe_kind VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  maximum_batch_count BIGINT UNSIGNED NOT NULL DEFAULT 1,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_recipe_id),
  CONSTRAINT chk_canonical_craft_recipe_kind CHECK (craft_recipe_kind IN ('item_exchange','building_upgrade')),
  CONSTRAINT chk_canonical_craft_recipe_batch CHECK (maximum_batch_count > 0),
  CONSTRAINT chk_canonical_craft_recipe_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_recipe_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_recipe_definition_imports (
  craft_recipe_definition_import_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_recipe_definition_import_id),
  UNIQUE KEY uq_canonical_craft_recipe_import_source (source_system, source_namespace, source_identifier),
  CONSTRAINT fk_canonical_craft_recipe_import_definition FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_recipe_import_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_recipe_import_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_recipe_item_inputs (
  craft_recipe_item_input_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_recipe_item_input_id), UNIQUE KEY uq_canonical_craft_item_input (craft_recipe_id, item_id),
  CONSTRAINT fk_canonical_craft_item_input_recipe FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_item_input_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_item_input_quantity CHECK (quantity > 0),
  CONSTRAINT chk_canonical_craft_item_input_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_item_input_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_recipe_currency_inputs (
  craft_recipe_currency_input_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_recipe_currency_input_id), UNIQUE KEY uq_canonical_craft_currency_input (craft_recipe_id, currency_id),
  CONSTRAINT fk_canonical_craft_currency_input_recipe FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_currency_input_currency FOREIGN KEY (currency_id) REFERENCES canonical_currency_definitions (currency_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_currency_input_amount CHECK (amount_minor > 0),
  CONSTRAINT chk_canonical_craft_currency_input_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_currency_input_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_recipe_item_outputs (
  craft_recipe_item_output_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_recipe_item_output_id), UNIQUE KEY uq_canonical_craft_item_output (craft_recipe_id, item_id),
  CONSTRAINT fk_canonical_craft_item_output_recipe FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_item_output_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_item_output_quantity CHECK (quantity > 0),
  CONSTRAINT chk_canonical_craft_item_output_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_item_output_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_recipe_currency_outputs (
  craft_recipe_currency_output_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_recipe_currency_output_id), UNIQUE KEY uq_canonical_craft_currency_output (craft_recipe_id, currency_id),
  CONSTRAINT fk_canonical_craft_currency_output_recipe FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_currency_output_currency FOREIGN KEY (currency_id) REFERENCES canonical_currency_definitions (currency_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_currency_output_amount CHECK (amount_minor > 0),
  CONSTRAINT chk_canonical_craft_currency_output_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_currency_output_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_building_craft_recipes (
  building_craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  building_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (building_craft_recipe_id), UNIQUE KEY uq_canonical_building_craft_recipe (building_id, craft_recipe_id),
  CONSTRAINT fk_canonical_building_craft_recipe_building FOREIGN KEY (building_id) REFERENCES canonical_building_definitions (building_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_building_craft_recipe_recipe FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_building_craft_recipe_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_building_craft_recipe_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_operations (
  craft_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_recipe_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(182) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_operation_id),
  UNIQUE KEY uq_canonical_craft_operation_owner (craft_operation_id, player_id),
  UNIQUE KEY uq_canonical_craft_operation_request (player_id, request_key),
  CONSTRAINT fk_canonical_craft_operation_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_operation_recipe FOREIGN KEY (craft_recipe_id) REFERENCES canonical_craft_recipe_definitions (craft_recipe_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_operation_count CHECK (requested_count > 0),
  CONSTRAINT chk_canonical_craft_operation_status CHECK (operation_status IN ('processing','completed')),
  CONSTRAINT chk_canonical_craft_operation_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_operation_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_item_ledger_entries (
  craft_item_ledger_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_item_stack_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity_delta BIGINT NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_item_ledger_entry_id), UNIQUE KEY uq_canonical_craft_item_ledger (craft_operation_id, item_id),
  CONSTRAINT fk_canonical_craft_item_ledger_operation_owner FOREIGN KEY (craft_operation_id, player_id) REFERENCES canonical_craft_operations (craft_operation_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_item_ledger_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_item_ledger_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_item_ledger_stack_owner_target FOREIGN KEY (owned_item_stack_id, player_id, item_id) REFERENCES canonical_owned_item_stacks (owned_item_stack_id, player_id, item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_item_ledger_delta CHECK (quantity_delta <> 0),
  CONSTRAINT chk_canonical_craft_item_ledger_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_item_ledger_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_craft_currency_ledger_entries (
  craft_currency_ledger_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  craft_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_currency_balance_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor_delta BIGINT NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL, INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL, UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (craft_currency_ledger_entry_id), UNIQUE KEY uq_canonical_craft_currency_ledger (craft_operation_id, currency_id),
  CONSTRAINT fk_canonical_craft_currency_ledger_operation_owner FOREIGN KEY (craft_operation_id, player_id) REFERENCES canonical_craft_operations (craft_operation_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_currency_ledger_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_currency_ledger_currency FOREIGN KEY (currency_id) REFERENCES canonical_currency_definitions (currency_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_craft_currency_ledger_balance_owner_target FOREIGN KEY (player_currency_balance_id, player_id, currency_id) REFERENCES canonical_player_currency_balances (player_currency_balance_id, player_id, currency_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_craft_currency_ledger_delta CHECK (amount_minor_delta <> 0),
  CONSTRAINT chk_canonical_craft_currency_ledger_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_craft_currency_ledger_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
