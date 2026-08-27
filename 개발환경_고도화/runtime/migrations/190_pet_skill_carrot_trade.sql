START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
VALUES('pet_skill_carrot_thermometer','🌡️당근온도기(/온도 아이디)','ITEM',TRUE,JSON_OBJECT('objectType','pet_skill_carrot_thermometer'),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE;

UPDATE item_definitions SET active=TRUE WHERE code='ITEM-RWD-044';

CREATE TABLE pet_skill_carrot_trades (
  operation_id BIGINT UNSIGNED NOT NULL,
  sender_player_id BIGINT UNSIGNED NOT NULL,
  recipient_player_id BIGINT UNSIGNED NOT NULL,
  sender_pet_id BIGINT UNSIGNED NOT NULL,
  recipient_pet_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  thermometer_item_id BIGINT UNSIGNED NOT NULL,
  thermometer_reward BIGINT UNSIGNED NOT NULL,
  sender_skill_quantity_before BIGINT UNSIGNED NOT NULL,
  sender_skill_quantity_after BIGINT UNSIGNED NOT NULL,
  recipient_skill_quantity_before BIGINT UNSIGNED NOT NULL,
  recipient_skill_quantity_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_pet_skill_carrot_recipient_created(recipient_player_id,created_at),
  CONSTRAINT fk_pet_skill_carrot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_sender FOREIGN KEY(sender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_recipient FOREIGN KEY(recipient_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_sender_pet FOREIGN KEY(sender_pet_id) REFERENCES player_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_recipient_pet FOREIGN KEY(recipient_pet_id) REFERENCES player_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_skill FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_carrot_item FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_carrot_thermometer_item FOREIGN KEY(thermometer_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_CARROT_TRADE','pet_skill_carrot_trade','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫스킬당근 [받을유저닉] [가방번호] [수량]','PET_SKILL_CARROT_TRADE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
