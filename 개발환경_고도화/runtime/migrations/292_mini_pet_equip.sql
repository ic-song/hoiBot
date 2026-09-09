CREATE TABLE mini_pet_equip_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  selected_owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  selected_version BIGINT UNSIGNED NOT NULL,
  previous_owned_mini_pet_id BIGINT UNSIGNED NULL,
  previous_version BIGINT UNSIGNED NULL,
  source_bag_sequence BIGINT UNSIGNED NOT NULL,
  source_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  consumed_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cancelled_at DATETIME(3) NULL,
  cancelled_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mini_pet_equip_pending (player_id, consumed_at, cancelled_at, expires_at),
  KEY idx_mini_pet_equip_selected (selected_owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_equip_confirmation_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_equipment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  confirmation_id BIGINT UNSIGNED NOT NULL,
  previous_owned_mini_pet_id BIGINT UNSIGNED NULL,
  selected_owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  previous_snapshot_json JSON NULL,
  selected_snapshot_json JSON NOT NULL,
  action_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_equipment_history_operation (operation_id),
  KEY idx_mini_pet_equipment_history_player (player_id, created_at),
  CONSTRAINT fk_mini_pet_equipment_history_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_equipment_history_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_equipment_history_confirmation FOREIGN KEY (confirmation_id) REFERENCES mini_pet_equip_confirmations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('MINI_PET_EQUIP','mini_pet_equip','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/미니펫장착','MINI_PET_EQUIP',TRUE),
  ('입양할래','MINI_PET_EQUIP',TRUE),
  ('생각해볼게','MINI_PET_EQUIP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
