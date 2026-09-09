START TRANSACTION;

CREATE TABLE IF NOT EXISTS player_sponsor_flags (
  player_id BIGINT UNSIGNED NOT NULL,
  first_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY ix_player_sponsor_flags_active (first_sponsor,player_id),
  CONSTRAINT fk_player_sponsor_flag_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_player_sponsor_flag_operator FOREIGN KEY (updated_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_sponsor_flag_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  before_value BOOLEAN NOT NULL,
  after_value BOOLEAN NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_sponsor_flag_event_operation (operation_id),
  KEY ix_player_sponsor_flag_event_player (player_id,created_at),
  CONSTRAINT fk_player_sponsor_event_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_sponsor_event_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_sponsor_event_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('ADMIN_FIRST_SPONSOR_REGISTER','admin_first_sponsor_registry','VERIFIED_USER','SHADOW',1,1),
  ('ADMIN_FIRST_SPONSOR_LIST','admin_first_sponsor_registry','VERIFIED_USER','SHADOW',1,1),
  ('ADMIN_FIRST_SPONSOR_RELEASE','admin_first_sponsor_registry','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/첫후원','ADMIN_FIRST_SPONSOR_REGISTER',1),
  ('/첫후원리스트','ADMIN_FIRST_SPONSOR_LIST',1),
  ('/첫후원해제','ADMIN_FIRST_SPONSOR_RELEASE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
