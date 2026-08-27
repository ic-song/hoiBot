START TRANSACTION;

CREATE TABLE pet_duel_emote_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  outcome_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome_roll DECIMAL(10,9) NOT NULL,
  phrase_roll DECIMAL(10,9) NOT NULL,
  phrase_index TINYINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_duel_emote_operation (operation_id),
  KEY idx_pet_duel_emote_actor (actor_player_id,created_at),
  KEY idx_pet_duel_emote_target (target_player_id,created_at),
  CONSTRAINT fk_pet_duel_emote_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_duel_emote_actor FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_duel_emote_target FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
 ('PET_DUEL_EMOTE','pet_duel_emote','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
 ('/결투','PET_DUEL_EMOTE',1),
 ('/결투 [유저명]','PET_DUEL_EMOTE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
