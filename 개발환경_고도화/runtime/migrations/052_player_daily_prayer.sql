CREATE TABLE IF NOT EXISTS rng_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  event_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sample_value DECIMAL(20,19) NOT NULL,
  threshold_value DECIMAL(20,19) NOT NULL,
  outcome_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rng_events_operation (operation_id),
  KEY idx_rng_events_player_period (player_id, event_code, period_key),
  CONSTRAINT fk_rng_events_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rng_events_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO skill_definitions (code,display_name,rules_json,active)
VALUES ('SKILL-PRAYER','기도','{"source":"legacy-pet-skill","effect":"daily_prayer"}',TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), rules_json = VALUES(rules_json), active = VALUES(active);

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('PLAYER_DAILY_PRAYER','PLAYER_DAILY_PRAYER','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key = VALUES(handler_key), auth_scope = VALUES(auth_scope), enabled = VALUES(enabled), version = version + 1;

INSERT INTO command_aliases (command_text,command_code,active)
VALUES ('/기도','PLAYER_DAILY_PRAYER',1)
ON DUPLICATE KEY UPDATE command_code = VALUES(command_code), active = VALUES(active);
