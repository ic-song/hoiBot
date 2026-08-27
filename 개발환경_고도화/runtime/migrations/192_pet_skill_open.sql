START TRANSACTION;

CREATE TABLE pet_skill_open_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  player_pet_id BIGINT UNSIGNED NOT NULL,
  book_item_id BIGINT UNSIGNED NOT NULL,
  open_count BIGINT UNSIGNED NOT NULL,
  book_quantity_before BIGINT UNSIGNED NOT NULL,
  book_quantity_after BIGINT UNSIGNED NOT NULL,
  skill_bag_quantity_before BIGINT UNSIGNED NOT NULL,
  skill_bag_quantity_after BIGINT UNSIGNED NOT NULL,
  catalog_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_snapshot_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_pet_skill_open_player_created(player_id,created_at),
  KEY idx_pet_skill_open_catalog_hash(catalog_hash),
  CONSTRAINT fk_pet_skill_open_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_open_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_open_pet FOREIGN KEY(player_pet_id) REFERENCES player_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_open_book_item FOREIGN KEY(book_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_skill_open_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  sample_value DECIMAL(20,19) NOT NULL,
  interval_lower DECIMAL(20,19) NOT NULL,
  interval_upper DECIMAL(20,19) NOT NULL,
  selected_skill_id BIGINT UNSIGNED NOT NULL,
  selected_skill_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selected_display_name VARCHAR(191) NOT NULL,
  selected_grade VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selected_rate DECIMAL(20,10) NOT NULL,
  selected_weight DECIMAL(30,10) NOT NULL,
  selected_rules_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id,sequence_no),
  KEY idx_pet_skill_open_draw_skill(selected_skill_id),
  CONSTRAINT fk_pet_skill_open_draw_operation FOREIGN KEY(operation_id) REFERENCES pet_skill_open_operations(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_open_draw_skill FOREIGN KEY(selected_skill_id) REFERENCES skill_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE item_definitions SET active=TRUE WHERE code='pet_skill_book';

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_OPEN','pet_skill_open','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/펫스킬오픈','PET_SKILL_OPEN',TRUE),
('/펫스킬오픈 [숫자]','PET_SKILL_OPEN',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
