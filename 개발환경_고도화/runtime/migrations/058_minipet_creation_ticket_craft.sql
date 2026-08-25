INSERT INTO mini_pet_definitions
  (code, display_name, grade_code, grade_display_name, emoji_value, active)
VALUES
  ('mini_pet_collection_creation', '컬렉션창조 미니펫', 'grade_creation', '창조', '🐹', TRUE)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), grade_code=VALUES(grade_code),
  grade_display_name=VALUES(grade_display_name), emoji_value=VALUES(emoji_value), active=VALUES(active);

CREATE TABLE mini_pet_creation_ticket_craft_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  material_item_id BIGINT UNSIGNED NOT NULL,
  material_quantity BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  after_sort_index SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_minipet_creation_ticket_owned (owned_mini_pet_id),
  UNIQUE KEY uq_minipet_creation_ticket_stable (stable_owned_id),
  KEY ix_minipet_creation_ticket_player (player_id, created_at),
  CONSTRAINT fk_minipet_creation_ticket_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_creation_ticket_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_creation_ticket_material FOREIGN KEY (material_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_creation_ticket_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_creation_ticket_environment CHECK (environment_code IN ('prod','dev')),
  CONSTRAINT ck_minipet_creation_ticket_material_quantity CHECK (material_quantity = 20000),
  CONSTRAINT ck_minipet_creation_ticket_sort CHECK (after_sort_index BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
