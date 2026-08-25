ALTER TABLE mini_pet_title_owned_states
  ADD CONSTRAINT ck_minipet_title_owned_sale_price CHECK (sale_price >= 0 AND sale_price = TRUNCATE(sale_price,0));

CREATE TABLE mini_pet_title_sale_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_name_snapshot VARCHAR(191) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  sale_price_snapshot DECIMAL(30,3) NOT NULL,
  point_proceeds DECIMAL(30,3) NOT NULL,
  selected_stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sold_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_minipet_title_sale_stable (stable_owned_title_id),
  KEY ix_minipet_title_sale_player (player_id,sold_at),
  CONSTRAINT fk_minipet_title_sale_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_sale_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_sale_definition FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_title_sale_order CHECK (display_order BETWEEN 1 AND 1000),
  CONSTRAINT ck_minipet_title_sale_price CHECK (sale_price_snapshot >= 0 AND point_proceeds = sale_price_snapshot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
