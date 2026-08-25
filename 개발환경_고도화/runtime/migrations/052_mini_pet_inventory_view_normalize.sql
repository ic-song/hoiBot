CREATE TABLE mini_pet_inventory_player_states (
  player_id BIGINT UNSIGNED NOT NULL,
  bag_shape_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'missing',
  capacity_limit SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_mini_pet_inventory_state_player FOREIGN KEY (player_id)
    REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mini_pet_inventory_shape CHECK (bag_shape_code IN ('missing', 'array', 'invalid')),
  CONSTRAINT ck_mini_pet_inventory_capacity CHECK (capacity_limit = 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_inventory_owned_states (
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_index SMALLINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owned_mini_pet_id),
  UNIQUE KEY uq_mini_pet_inventory_stable_owned (stable_owned_id),
  UNIQUE KEY uq_mini_pet_inventory_player_sort (player_id, sort_index),
  CONSTRAINT fk_mini_pet_inventory_owned FOREIGN KEY (owned_mini_pet_id)
    REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_inventory_owned_player FOREIGN KEY (player_id)
    REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mini_pet_inventory_sort CHECK (sort_index IS NULL OR sort_index BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_inventory_repair_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
  repair_diff_json JSON NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (operation_id),
  KEY ix_mini_pet_inventory_repair_status (environment_code, status, started_at),
  CONSTRAINT fk_mini_pet_inventory_repair_operation FOREIGN KEY (operation_id)
    REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mini_pet_inventory_repair_environment CHECK (environment_code IN ('prod', 'dev')),
  CONSTRAINT ck_mini_pet_inventory_repair_status CHECK (status IN ('processing', 'completed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_inventory_repair_entries (
  operation_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  before_sort_index SMALLINT UNSIGNED NULL,
  after_sort_index SMALLINT UNSIGNED NULL,
  stable_id_created BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (operation_id, owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_inventory_repair_entry_operation FOREIGN KEY (operation_id)
    REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_inventory_repair_entry_owned FOREIGN KEY (owned_mini_pet_id)
    REFERENCES owned_mini_pets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
