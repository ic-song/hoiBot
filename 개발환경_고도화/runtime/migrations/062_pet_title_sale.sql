CREATE TABLE player_title_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stable_assignment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  source_price DECIMAL(30,3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  acquired_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_title_assignment_stable (stable_assignment_id),
  UNIQUE KEY uq_player_title_assignment_order (player_id,display_order),
  KEY ix_player_title_assignment_title (player_id,title_id),
  CONSTRAINT fk_player_title_assignment_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_title_assignment_definition FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_player_title_assignment_order CHECK (display_order BETWEEN 1 AND 1000),
  CONSTRAINT ck_player_title_assignment_price CHECK (source_price >= 0 AND source_price = TRUNCATE(source_price,0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_title_state (
  player_id BIGINT UNSIGNED NOT NULL,
  equipped_assignment_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  UNIQUE KEY uq_player_title_state_equipped (equipped_assignment_id),
  CONSTRAINT fk_player_title_state_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_title_state_equipped FOREIGN KEY (equipped_assignment_id) REFERENCES player_title_assignments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_title_sale_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  stable_assignment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_name_snapshot VARCHAR(191) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  source_price_snapshot DECIMAL(30,3) NOT NULL,
  point_proceeds DECIMAL(30,3) NOT NULL,
  was_equipped BOOLEAN NOT NULL,
  sold_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_pet_title_sale_stable (stable_assignment_id),
  KEY ix_pet_title_sale_player (player_id,sold_at),
  CONSTRAINT fk_pet_title_sale_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_title_sale_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_title_sale_definition FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_pet_title_sale_order CHECK (display_order BETWEEN 1 AND 1000),
  CONSTRAINT ck_pet_title_sale_values CHECK (source_price_snapshot >= 0 AND point_proceeds >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
