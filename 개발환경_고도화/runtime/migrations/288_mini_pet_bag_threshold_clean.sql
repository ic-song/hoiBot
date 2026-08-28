START TRANSACTION;

ALTER TABLE owned_mini_pets
  ADD COLUMN sale_price BIGINT NULL AFTER raid_experience,
  ADD COLUMN is_elite BOOLEAN NOT NULL DEFAULT FALSE AFTER sale_price,
  ADD COLUMN bag_sequence BIGINT UNSIGNED NULL AFTER is_elite,
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER bag_sequence,
  ADD KEY idx_owned_mini_pets_bag_order (player_id, equipped, bag_sequence, id);

CREATE TABLE mini_pet_bag_cleanup_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  threshold_value BIGINT UNSIGNED NOT NULL,
  removed_count INT UNSIGNED NOT NULL,
  point_delta BIGINT NOT NULL,
  balance_before DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_bag_cleanup_operation (operation_id),
  CONSTRAINT fk_mini_pet_bag_cleanup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_bag_cleanup_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_bag_cleanup_lines (
  cleanup_run_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  previous_bag_sequence BIGINT UNSIGNED NULL,
  sale_price BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  PRIMARY KEY (cleanup_run_id, sequence_no),
  UNIQUE KEY uq_mini_pet_bag_cleanup_owned (owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_bag_cleanup_line_run FOREIGN KEY (cleanup_run_id) REFERENCES mini_pet_bag_cleanup_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_bag_cleanup_line_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_BAG_THRESHOLD_CLEAN','mini_pet_bag_threshold_clean','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫가방정리','MINI_PET_BAG_THRESHOLD_CLEAN',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
