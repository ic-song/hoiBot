-- WBS740: canonical currency definition, player balance, idempotent operation, and append-only ledger.
-- Requires 443_object_identity_audit_provider.sql and 444_canonical_item_inventory.sql.
CREATE TABLE canonical_currency_definitions (
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  decimal_places TINYINT UNSIGNED NOT NULL DEFAULT 0,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (currency_id),
  CONSTRAINT chk_canonical_currency_decimal_places CHECK (decimal_places BETWEEN 0 AND 9),
  CONSTRAINT chk_canonical_currency_definitions_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_currency_definitions_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_currency_definition_imports (
  currency_definition_import_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (currency_definition_import_id),
  UNIQUE KEY uq_canonical_currency_import_source (source_system, source_namespace, source_identifier),
  CONSTRAINT fk_canonical_currency_import_definition FOREIGN KEY (currency_id) REFERENCES canonical_currency_definitions (currency_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_currency_imports_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_currency_imports_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_player_currency_balances (
  player_currency_balance_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  balance_minor_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_currency_balance_id),
  UNIQUE KEY uq_canonical_player_currency_balance (player_id, currency_id),
  UNIQUE KEY uq_canonical_player_currency_balance_owner (player_currency_balance_id, player_id, currency_id),
  CONSTRAINT fk_canonical_player_currency_balance_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_player_currency_balance_definition FOREIGN KEY (currency_id) REFERENCES canonical_currency_definitions (currency_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_player_currency_balances_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_player_currency_balances_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_currency_operations (
  currency_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_currency_balance_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(182) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation_kind VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delta_minor_amount BIGINT NOT NULL,
  balance_after_minor_amount BIGINT UNSIGNED NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (currency_operation_id),
  UNIQUE KEY uq_canonical_currency_operation_request (player_id, request_key),
  UNIQUE KEY uq_canonical_currency_operation_balance (currency_operation_id, player_currency_balance_id),
  CONSTRAINT fk_canonical_currency_operation_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_currency_operation_definition FOREIGN KEY (currency_id) REFERENCES canonical_currency_definitions (currency_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_currency_operation_balance FOREIGN KEY (player_currency_balance_id) REFERENCES canonical_player_currency_balances (player_currency_balance_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_currency_operation_balance_owner FOREIGN KEY (player_currency_balance_id, player_id, currency_id) REFERENCES canonical_player_currency_balances (player_currency_balance_id, player_id, currency_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_currency_operation_status CHECK (operation_status = 'completed'),
  CONSTRAINT chk_canonical_currency_operations_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_currency_operations_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_currency_ledger_entries (
  currency_ledger_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_currency_balance_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sequence_number INT UNSIGNED NOT NULL,
  delta_minor_amount BIGINT NOT NULL,
  balance_after_minor_amount BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (currency_ledger_entry_id),
  UNIQUE KEY uq_canonical_currency_ledger_sequence (currency_operation_id, sequence_number),
  KEY idx_canonical_currency_ledger_balance (player_currency_balance_id, INSERT_TIME),
  CONSTRAINT fk_canonical_currency_ledger_operation FOREIGN KEY (currency_operation_id) REFERENCES canonical_currency_operations (currency_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_currency_ledger_balance FOREIGN KEY (player_currency_balance_id) REFERENCES canonical_player_currency_balances (player_currency_balance_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_currency_ledger_operation_balance FOREIGN KEY (currency_operation_id, player_currency_balance_id) REFERENCES canonical_currency_operations (currency_operation_id, player_currency_balance_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_currency_ledger_entries_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_currency_ledger_entries_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
