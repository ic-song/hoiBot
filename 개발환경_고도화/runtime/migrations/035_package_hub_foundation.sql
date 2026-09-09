CREATE TABLE IF NOT EXISTS package_item_definitions (
  item_id VARCHAR(64) NOT NULL,
  item_type VARCHAR(32) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  stackable TINYINT(1) NOT NULL,
  metadata_json JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (item_id),
  UNIQUE KEY uq_item_definition_name_type (item_name, item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_item_balances (
  owner_type VARCHAR(16) NOT NULL,
  owner_id VARCHAR(191) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  quantity BIGINT NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_type, owner_id, item_id),
  CONSTRAINT fk_item_balance_definition FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id),
  CONSTRAINT ck_item_balance_nonnegative CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_item_instances (
  instance_id CHAR(36) NOT NULL,
  owner_type VARCHAR(16) NOT NULL,
  owner_id VARCHAR(191) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  target_instance_id CHAR(36) NULL,
  instance_metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at DATETIME(3) NULL,
  PRIMARY KEY (instance_id),
  KEY ix_item_instance_owner (owner_type, owner_id, item_id, removed_at),
  CONSTRAINT fk_item_instance_definition FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_catalog (
  package_id VARCHAR(64) NOT NULL,
  catalog_version VARCHAR(64) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  consume_item_id VARCHAR(64) NOT NULL,
  max_open_count INT UNSIGNED NOT NULL,
  definition_status VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (package_id),
  UNIQUE KEY uq_package_consume_item (consume_item_id),
  CONSTRAINT fk_package_consume_item FOREIGN KEY (consume_item_id) REFERENCES package_item_definitions(item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_command_aliases (
  command_text VARCHAR(191) NOT NULL,
  package_id VARCHAR(64) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  deprecated_at DATETIME(3) NULL,
  PRIMARY KEY (command_text),
  CONSTRAINT fk_package_alias_catalog FOREIGN KEY (package_id) REFERENCES package_catalog(package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_rewards (
  package_id VARCHAR(64) NOT NULL,
  reward_order INT UNSIGNED NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  quantity BIGINT NOT NULL,
  probability DECIMAL(12,9) NULL,
  target_selector VARCHAR(64) NULL,
  metadata_override_json JSON NULL,
  PRIMARY KEY (package_id, reward_order),
  CONSTRAINT fk_package_reward_catalog FOREIGN KEY (package_id) REFERENCES package_catalog(package_id),
  CONSTRAINT fk_package_reward_item FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id),
  CONSTRAINT ck_package_reward_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_item_ledger (
  ledger_id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  owner_type VARCHAR(16) NOT NULL,
  owner_id VARCHAR(191) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  quantity_delta BIGINT NOT NULL,
  instance_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ledger_id),
  KEY ix_package_item_ledger_operation (operation_id),
  CONSTRAINT fk_package_item_ledger_definition FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_use_operations (
  operation_id CHAR(36) NOT NULL,
  request_key VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  package_id VARCHAR(64) NOT NULL,
  open_count INT UNSIGNED NOT NULL,
  catalog_version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  committed_at DATETIME(3) NULL,
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_package_use_request (request_key),
  CONSTRAINT fk_package_use_catalog FOREIGN KEY (package_id) REFERENCES package_catalog(package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

