START TRANSACTION;

INSERT INTO configuration_sets(set_code,version,status,effective_from)
VALUES ('happy.foundation',1,'active',UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE status=VALUES(status);

CREATE TABLE IF NOT EXISTS foundation_states (
  foundation_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configuration_set_id BIGINT UNSIGNED NOT NULL,
  captain_player_id BIGINT UNSIGNED NULL,
  total_amount DECIMAL(30,3) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (foundation_code),
  UNIQUE KEY uq_foundation_state_config_set (configuration_set_id),
  CONSTRAINT fk_foundation_state_config FOREIGN KEY (configuration_set_id) REFERENCES configuration_sets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_foundation_state_captain FOREIGN KEY (captain_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_foundation_state_operator FOREIGN KEY (updated_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT chk_foundation_total_nonnegative CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO foundation_states(foundation_code,configuration_set_id,captain_player_id,total_amount,version)
SELECT 'happy',id,NULL,0,1 FROM configuration_sets WHERE set_code='happy.foundation' AND version=1
ON DUPLICATE KEY UPDATE configuration_set_id=VALUES(configuration_set_id);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HAPPY_FOUNDATION_CAPTAIN_CHANGE','happy_foundation_captain','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/행복단장변경','HAPPY_FOUNDATION_CAPTAIN_CHANGE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
