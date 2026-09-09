-- WBS733: 기존 숫자 PK 기반 인벤토리는 그대로 보존하고 표준 canonical item 경로를 추가합니다.
CREATE TABLE canonical_players (
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_id),
  UNIQUE KEY uq_canonical_players_source (source_system, source_identifier),
  CONSTRAINT chk_canonical_players_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_players_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_item_definitions (
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  item_description TEXT NULL,
  item_kind VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_grade VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_amount DECIMAL(30,3) NULL,
  -- WBS740의 canonical currency provider가 CUID PK/FK를 제공하기 전까지 source 식별자만 보존합니다.
  price_currency_source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  stackable_flag BOOLEAN NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  definition_options JSON NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (item_id),
  CONSTRAINT chk_canonical_item_definitions_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_item_definitions_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_item_definition_imports (
  item_definition_import_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (item_definition_import_id),
  UNIQUE KEY uq_canonical_item_definition_import_source (source_system, source_namespace, source_identifier),
  KEY idx_canonical_item_definition_import_item (item_id),
  CONSTRAINT fk_canonical_item_definition_import_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_item_definition_import_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_item_definition_import_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_item_stacks (
  owned_item_stack_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_item_stack_id),
  UNIQUE KEY uq_canonical_owned_item_stacks_player_item (player_id, item_id),
  CONSTRAINT fk_canonical_owned_item_stacks_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_item_stacks_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_item_stacks_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_item_stacks_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_item_instances (
  owned_item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ownership_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  instance_options JSON NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_item_id),
  KEY idx_canonical_owned_item_instances_owner_item (player_id, item_id, ownership_status),
  CONSTRAINT fk_canonical_owned_item_instances_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_item_instances_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_item_instances_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_item_instances_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_item_inventory_operations (
  item_inventory_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resulting_quantity BIGINT UNSIGNED NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (item_inventory_operation_id),
  UNIQUE KEY uq_canonical_item_inventory_operations_player_request (player_id, request_key),
  CONSTRAINT fk_canonical_item_inventory_operations_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_item_inventory_operations_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_item_inventory_operations_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_item_inventory_ledger_entries (
  item_inventory_ledger_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_inventory_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_item_stack_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  owned_item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  quantity_delta BIGINT NOT NULL,
  reason_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (item_inventory_ledger_entry_id),
  UNIQUE KEY uq_canonical_item_inventory_ledger_operation (item_inventory_operation_id),
  CONSTRAINT fk_canonical_item_inventory_ledger_operation FOREIGN KEY (item_inventory_operation_id) REFERENCES canonical_item_inventory_operations (item_inventory_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_item_inventory_ledger_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_item_inventory_ledger_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_item_inventory_ledger_stack FOREIGN KEY (owned_item_stack_id) REFERENCES canonical_owned_item_stacks (owned_item_stack_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_item_inventory_ledger_instance FOREIGN KEY (owned_item_id) REFERENCES canonical_owned_item_instances (owned_item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_item_inventory_ledger_target CHECK ((owned_item_stack_id IS NULL) <> (owned_item_id IS NULL)),
  CONSTRAINT chk_canonical_item_inventory_ledger_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_item_inventory_ledger_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
