START TRANSACTION;
CREATE TABLE pendant_carrot_trades (
  operation_id BIGINT UNSIGNED NOT NULL, sender_player_id BIGINT UNSIGNED NOT NULL, recipient_player_id BIGINT UNSIGNED NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL, source_index INT UNSIGNED NOT NULL, carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL, instance_version_before BIGINT UNSIGNED NOT NULL, instance_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), PRIMARY KEY(operation_id), KEY idx_pendant_carrot_recipient_created(recipient_player_id,created_at),
  CONSTRAINT fk_pendant_carrot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_carrot_sender FOREIGN KEY(sender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_carrot_recipient FOREIGN KEY(recipient_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_carrot_instance FOREIGN KEY(inventory_instance_id) REFERENCES inventory_instances(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_carrot_item FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('PENDANT_CARROT_TRADE','pendant_carrot_trade','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펜던트당근','PENDANT_CARROT_TRADE',1),('/펜던트당근거래','PENDANT_CARROT_TRADE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
