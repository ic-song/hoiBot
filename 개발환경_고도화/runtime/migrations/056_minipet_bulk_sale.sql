CREATE TABLE mini_pet_bulk_sale_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  start_sort_index SMALLINT UNSIGNED NOT NULL,
  end_sort_index SMALLINT UNSIGNED NOT NULL,
  sold_count SMALLINT UNSIGNED NOT NULL,
  point_proceeds DECIMAL(30,3) NOT NULL,
  sold_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_minipet_bulk_sale_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_bulk_sale_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_bulk_sale_range CHECK (start_sort_index BETWEEN 1 AND 100 AND end_sort_index BETWEEN start_sort_index AND 100),
  CONSTRAINT ck_minipet_bulk_sale_count CHECK (sold_count BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_bulk_sale_entries (
  operation_id BIGINT UNSIGNED NOT NULL,
  ordinal SMALLINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  point_proceeds DECIMAL(30,3) NOT NULL,
  PRIMARY KEY (operation_id, ordinal),
  UNIQUE KEY uq_minipet_bulk_sale_owned (owned_mini_pet_id),
  UNIQUE KEY uq_minipet_bulk_sale_stable (stable_owned_id),
  CONSTRAINT fk_minipet_bulk_sale_entry_event FOREIGN KEY (operation_id) REFERENCES mini_pet_bulk_sale_events(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_bulk_sale_entry_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_bulk_sale_entry_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
