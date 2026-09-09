START TRANSACTION;

CREATE TABLE market_carrot_trade_policy (
  policy_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  carrot_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  thermometer_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  carrot_fee_per_unit BIGINT UNSIGNED NOT NULL,
  thermometer_reward BIGINT UNSIGNED NOT NULL,
  sender_counter_increment BIGINT UNSIGNED NOT NULL,
  stack_slot_limit BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO market_carrot_trade_policy
  (policy_key,carrot_item_code,thermometer_item_code,carrot_fee_per_unit,thermometer_reward,sender_counter_increment,stack_slot_limit)
VALUES ('default','ITEM-RWD-044','pet_skill_carrot_thermometer',1,2,1,100)
ON DUPLICATE KEY UPDATE carrot_item_code=VALUES(carrot_item_code),thermometer_item_code=VALUES(thermometer_item_code),
  carrot_fee_per_unit=VALUES(carrot_fee_per_unit),thermometer_reward=VALUES(thermometer_reward),
  sender_counter_increment=VALUES(sender_counter_increment),stack_slot_limit=VALUES(stack_slot_limit);

CREATE TABLE market_carrot_trade_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  sender_player_id BIGINT UNSIGNED NOT NULL,
  recipient_player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  thermometer_item_id BIGINT UNSIGNED NOT NULL,
  thermometer_reward BIGINT UNSIGNED NOT NULL,
  sender_counter_increment BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_market_carrot_trade_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_carrot_trade_sender FOREIGN KEY(sender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_carrot_trade_recipient FOREIGN KEY(recipient_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_carrot_trade_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_carrot_trade_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_carrot_trade_thermometer FOREIGN KEY(thermometer_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MARKET_CARROT_TRADE','market_carrot_trade','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/당근','MARKET_CARROT_TRADE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
