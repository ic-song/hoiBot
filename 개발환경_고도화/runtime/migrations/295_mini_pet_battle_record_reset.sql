START TRANSACTION;

CREATE TABLE mini_pet_battle_record_reset_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  reset_date DATE NOT NULL,
  previous_win_count BIGINT UNSIGNED NOT NULL,
  previous_loss_count BIGINT UNSIGNED NOT NULL,
  previous_battle_attempts BIGINT UNSIGNED NOT NULL,
  ticket_quantity BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_mini_pet_record_reset_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_mini_pet_record_reset_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_mini_pet_record_reset_ticket FOREIGN KEY(ticket_item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_BATTLE_RECORD_RESET','mini_pet_battle_record_reset','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫전적초기화','MINI_PET_BATTLE_RECORD_RESET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
