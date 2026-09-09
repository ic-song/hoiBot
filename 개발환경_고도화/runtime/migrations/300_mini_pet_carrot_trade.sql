START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
VALUES('pet_skill_carrot_thermometer','🌡️당근온도기(/온도 아이디)','ITEM',TRUE,JSON_OBJECT('objectType','carrot_thermometer'),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,active=TRUE;

UPDATE item_definitions SET active=TRUE WHERE code='ITEM-RWD-044';

CREATE TABLE mini_pet_carrot_trades (
  operation_id BIGINT UNSIGNED NOT NULL,
  sender_player_id BIGINT UNSIGNED NOT NULL,
  recipient_player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  source_bag_sequence BIGINT UNSIGNED NOT NULL,
  recipient_bag_sequence BIGINT UNSIGNED NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  thermometer_item_id BIGINT UNSIGNED NOT NULL,
  thermometer_reward BIGINT UNSIGNED NOT NULL,
  pet_version_before BIGINT UNSIGNED NOT NULL,
  pet_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_minipet_carrot_trade_recipient_created(recipient_player_id,created_at),
  CONSTRAINT fk_minipet_carrot_trade_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_carrot_trade_sender FOREIGN KEY(sender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_carrot_trade_recipient FOREIGN KEY(recipient_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_carrot_trade_owned FOREIGN KEY(owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_carrot_trade_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_carrot_trade_thermometer FOREIGN KEY(thermometer_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_CARROT_TRADE','mini_pet_carrot_trade','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫당근','MINI_PET_CARROT_TRADE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
