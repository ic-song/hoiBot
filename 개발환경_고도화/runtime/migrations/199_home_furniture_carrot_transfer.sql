START TRANSACTION;

CREATE TABLE furniture_carrot_trades (
  operation_id BIGINT UNSIGNED NOT NULL,
  sender_player_id BIGINT UNSIGNED NOT NULL,
  recipient_player_id BIGINT UNSIGNED NOT NULL,
  furniture_instance_id BIGINT UNSIGNED NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  thermometer_item_id BIGINT UNSIGNED NOT NULL,
  thermometer_reward BIGINT UNSIGNED NOT NULL,
  source_version_before BIGINT UNSIGNED NOT NULL,
  source_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_furniture_carrot_trades_recipient_created(recipient_player_id,created_at),
  CONSTRAINT fk_furniture_carrot_trade_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_furniture_carrot_trade_sender FOREIGN KEY(sender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_furniture_carrot_trade_recipient FOREIGN KEY(recipient_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_furniture_carrot_trade_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT,
  CONSTRAINT fk_furniture_carrot_trade_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_furniture_carrot_trade_thermometer FOREIGN KEY(thermometer_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_FURNITURE_CARROT_TRANSFER','home_furniture_carrot_transfer','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/가구당근 [받는닉네임] [가구번호]','HOME_FURNITURE_CARROT_TRANSFER',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
