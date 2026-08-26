START TRANSACTION;

CREATE TABLE player_rebirth_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  previous_level BIGINT UNSIGNED NOT NULL,
  next_level BIGINT UNSIGNED NOT NULL,
  previous_accumulated_level BIGINT UNSIGNED NOT NULL,
  next_accumulated_level BIGINT UNSIGNED NOT NULL,
  previous_rebirth_count BIGINT UNSIGNED NOT NULL,
  next_rebirth_count BIGINT UNSIGNED NOT NULL,
  forced BOOLEAN NOT NULL,
  mushroom_consumed BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_rebirth_operation (operation_id),
  KEY idx_player_rebirth_player (player_id,created_at),
  CONSTRAINT fk_player_rebirth_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_rebirth_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
 ('PET_REBIRTH','pet_rebirth','VERIFIED_USER','SHADOW',1,1),
 ('ADMIN_PET_REBIRTH','pet_rebirth','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
 ('/환생','PET_REBIRTH',1),
 ('/환생 [유저명]','ADMIN_PET_REBIRTH',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
