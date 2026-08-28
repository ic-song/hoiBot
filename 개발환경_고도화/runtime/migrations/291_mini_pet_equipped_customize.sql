START TRANSACTION;

ALTER TABLE owned_mini_pets
  ADD COLUMN custom_emoji VARCHAR(191) NULL AFTER custom_name;

CREATE TABLE mini_pet_customization_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  customization_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_value VARCHAR(191) NOT NULL,
  next_value VARCHAR(191) NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  mini_pet_version_before BIGINT UNSIGNED NOT NULL,
  mini_pet_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_mini_pet_customization_asset (owned_mini_pet_id, created_at),
  CONSTRAINT fk_mini_pet_customization_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_customization_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_customization_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_customization_item FOREIGN KEY (ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active)
VALUES
  ('legacy-mini-pet-appearance-change-ticket','미니펫외형변경권😺(/미니펫외형)','item',TRUE,TRUE),
  ('legacy-mini-pet-name-change-ticket','미니펫이름변경권🙀(/미니펫이름)','item',TRUE,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('MINI_PET_APPEARANCE_CUSTOMIZE','mini_pet_equipped_customize','VERIFIED_USER','SHADOW',TRUE,1),
  ('MINI_PET_NAME_CUSTOMIZE','mini_pet_equipped_customize','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/미니펫외형','MINI_PET_APPEARANCE_CUSTOMIZE',TRUE),
  ('/미니펫이름','MINI_PET_NAME_CUSTOMIZE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
