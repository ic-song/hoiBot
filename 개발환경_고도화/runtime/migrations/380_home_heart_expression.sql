START TRANSACTION;

CREATE TABLE home_heart_expression_totals (
  home_player_id BIGINT UNSIGNED NOT NULL,
  reaction_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (home_player_id,reaction_code),
  CONSTRAINT fk_home_heart_total_player FOREIGN KEY (home_player_id) REFERENCES players(id),
  CONSTRAINT chk_home_heart_total_code CHECK (reaction_code IN ('cute','cheer','cool','love'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_heart_expression_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  command_name VARCHAR(16) NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  limit_before BIGINT UNSIGNED NOT NULL,
  used_before BIGINT UNSIGNED NOT NULL,
  used_after BIGINT UNSIGNED NOT NULL,
  remaining_after BIGINT UNSIGNED NOT NULL,
  allocations_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_heart_execution_actor (actor_player_id,usage_date),
  KEY idx_home_heart_execution_target (target_player_id,created_at),
  CONSTRAINT fk_home_heart_execution_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_heart_execution_actor FOREIGN KEY (actor_player_id) REFERENCES players(id),
  CONSTRAINT fk_home_heart_execution_target FOREIGN KEY (target_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_heart_expression_rolls (
  operation_id BIGINT UNSIGNED NOT NULL,
  roll_ordinal BIGINT UNSIGNED NOT NULL,
  sample DECIMAL(20,19) NULL,
  reaction_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (operation_id,roll_ordinal),
  CONSTRAINT fk_home_heart_roll_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_home_heart_roll_code CHECK (reaction_code IN ('cute','cheer','cool','love'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_HEART_EXPRESSION','home_heart_expression','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/마음','HOME_HEART_EXPRESSION',TRUE),('/사랑해','HOME_HEART_EXPRESSION',TRUE),('/귀여워','HOME_HEART_EXPRESSION',TRUE),('/멋져요','HOME_HEART_EXPRESSION',TRUE),('/응원해','HOME_HEART_EXPRESSION',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
