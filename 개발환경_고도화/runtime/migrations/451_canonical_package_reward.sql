-- WBS739: additive canonical package definitions, typed rewards, quarantine, and replay.
-- Requires 443_object_identity_audit_provider.sql and 444_canonical_item_inventory.sql.
-- Legacy package_catalog/package_item_definitions/object_registry remain compatibility inputs only.
CREATE TABLE canonical_package_definitions (
  package_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  package_description TEXT NULL,
  max_open_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_id),
  CONSTRAINT chk_canonical_package_max_open CHECK (max_open_quantity > 0),
  CONSTRAINT chk_canonical_package_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_package_definition_imports (
  package_definition_import_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_definition_import_id),
  UNIQUE KEY uq_canonical_package_import_source (source_system, source_namespace, source_identifier),
  CONSTRAINT fk_canonical_package_import_definition FOREIGN KEY (package_id) REFERENCES canonical_package_definitions (package_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_import_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_import_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A group identifies the source package once, so typed reward rows can use exact FK names
-- for item_id and nested package_id without an ambiguous parent_package_id exception.
CREATE TABLE canonical_package_reward_groups (
  package_reward_group_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_reward_group_id),
  UNIQUE KEY uq_canonical_package_reward_group (package_id),
  CONSTRAINT fk_canonical_package_reward_group_definition FOREIGN KEY (package_id) REFERENCES canonical_package_definitions (package_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_reward_selection CHECK (selection_mode IN ('all','weighted_one')),
  CONSTRAINT chk_canonical_package_reward_group_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_reward_group_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_package_reward_entries (
  package_reward_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_reward_group_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_order INT UNSIGNED NOT NULL,
  target_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_reward_entry_id),
  UNIQUE KEY uq_canonical_package_reward_entry_order (package_reward_group_id, reward_order),
  CONSTRAINT fk_canonical_package_reward_entry_group FOREIGN KEY (package_reward_group_id) REFERENCES canonical_package_reward_groups (package_reward_group_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_reward_entry_kind CHECK (target_kind IN ('item','package','gap')),
  CONSTRAINT chk_canonical_package_reward_entry_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_reward_entry_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_package_item_rewards (
  package_reward_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  probability DECIMAL(12,10) NOT NULL DEFAULT 1,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_reward_entry_id),
  CONSTRAINT fk_canonical_package_item_reward_entry FOREIGN KEY (package_reward_entry_id) REFERENCES canonical_package_reward_entries (package_reward_entry_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_package_item_reward_definition FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_item_reward_quantity CHECK (quantity > 0),
  CONSTRAINT chk_canonical_package_item_reward_probability CHECK (probability > 0 AND probability <= 1),
  CONSTRAINT chk_canonical_package_item_reward_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_item_reward_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_package_nested_rewards (
  package_reward_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  probability DECIMAL(12,10) NOT NULL DEFAULT 1,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_reward_entry_id),
  CONSTRAINT fk_canonical_package_nested_reward_entry FOREIGN KEY (package_reward_entry_id) REFERENCES canonical_package_reward_entries (package_reward_entry_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_package_nested_reward_definition FOREIGN KEY (package_id) REFERENCES canonical_package_definitions (package_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_nested_reward_quantity CHECK (quantity > 0),
  CONSTRAINT chk_canonical_package_nested_reward_probability CHECK (probability > 0 AND probability <= 1),
  CONSTRAINT chk_canonical_package_nested_reward_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_nested_reward_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_package_reward_quarantines (
  package_reward_quarantine_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_reward_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_reward_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  target_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  target_display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  quarantine_reason VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quarantine_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'open',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_reward_quarantine_id),
  UNIQUE KEY uq_canonical_package_reward_quarantine_entry (package_reward_entry_id),
  UNIQUE KEY uq_canonical_package_reward_quarantine (package_id, source_reward_identifier),
  CONSTRAINT fk_canonical_package_reward_quarantine_entry FOREIGN KEY (package_reward_entry_id) REFERENCES canonical_package_reward_entries (package_reward_entry_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_package_reward_quarantine_definition FOREIGN KEY (package_id) REFERENCES canonical_package_definitions (package_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_reward_quarantine_kind CHECK (target_kind IN ('item','package')),
  CONSTRAINT chk_canonical_package_reward_quarantine_status CHECK (quarantine_status IN ('open','resolved','rejected')),
  CONSTRAINT chk_canonical_package_reward_quarantine_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_reward_quarantine_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_package_definition_replays (
  package_definition_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(182) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (package_definition_operation_id),
  UNIQUE KEY uq_canonical_package_definition_request (source_system, source_namespace, request_key),
  CONSTRAINT fk_canonical_package_definition_replay_definition FOREIGN KEY (package_id) REFERENCES canonical_package_definitions (package_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_package_definition_replay_status CHECK (operation_status = 'completed'),
  CONSTRAINT chk_canonical_package_definition_replay_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_package_definition_replay_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
