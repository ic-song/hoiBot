CREATE TABLE mini_pet_sale_policies (
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  point_price DECIMAL(30,3) NOT NULL,
  sellable BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (mini_pet_definition_id),
  CONSTRAINT fk_mini_pet_sale_policy_definition FOREIGN KEY (mini_pet_definition_id)
    REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mini_pet_sale_policy_price CHECK (point_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_owned_lifecycle (
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  state_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  bound BOOLEAN NOT NULL DEFAULT FALSE,
  listed BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (owned_mini_pet_id),
  KEY ix_mini_pet_owned_lifecycle_player_state (player_id, state_code),
  CONSTRAINT fk_mini_pet_owned_lifecycle_owned FOREIGN KEY (owned_mini_pet_id)
    REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_owned_lifecycle_player FOREIGN KEY (player_id)
    REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mini_pet_owned_lifecycle_state CHECK (state_code IN ('active', 'sold'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_sale_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  point_proceeds DECIMAL(30,3) NOT NULL,
  sold_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_mini_pet_sale_owned (owned_mini_pet_id),
  UNIQUE KEY uq_mini_pet_sale_stable_owned (stable_owned_id),
  CONSTRAINT fk_mini_pet_sale_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_sale_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_sale_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_sale_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
