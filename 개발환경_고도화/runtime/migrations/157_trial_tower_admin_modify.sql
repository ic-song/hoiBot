START TRANSACTION;

CREATE TABLE trial_tower_progress_adjustments (
  operation_id BIGINT UNSIGNED NOT NULL,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  previous_floor BIGINT UNSIGNED NOT NULL,
  adjusted_floor BIGINT UNSIGNED NOT NULL,
  adjusted_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_trial_adjustment_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_adjustment_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_adjustment_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_TRIAL_TOWER_MODIFY','trial_tower_admin_modify','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/시련의탑수정 {닉네임} {층수}','ADMIN_TRIAL_TOWER_MODIFY',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
