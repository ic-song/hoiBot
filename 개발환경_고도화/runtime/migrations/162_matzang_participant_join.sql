START TRANSACTION;

CREATE TABLE matzang_participant_join_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_total_exp BIGINT UNSIGNED NOT NULL,
  snapshot_pet_type VARCHAR(32) NULL,
  snapshot_upgrade_level INT UNSIGNED NOT NULL,
  remaining_count INT UNSIGNED NOT NULL,
  participant_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_matzang_join_player (field_key, player_id, created_at),
  CONSTRAINT fk_matzang_join_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_matzang_join_field FOREIGN KEY (field_key) REFERENCES matzang_fields(field_key) ON DELETE RESTRICT,
  CONSTRAINT fk_matzang_join_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('MATZZANG_PARTICIPANT_JOIN','matzang_participant_join','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/참여','MATZZANG_PARTICIPANT_JOIN',1),('ㅊㅇ','MATZZANG_PARTICIPANT_JOIN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
