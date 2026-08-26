START TRANSACTION;

CREATE TABLE trial_tower_reset_snapshots (
  operation_id BIGINT UNSIGNED NOT NULL,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  floor BIGINT UNSIGNED NOT NULL,
  last_win_at DATETIME(3) NULL,
  progress_version BIGINT UNSIGNED NOT NULL,
  snapshotted_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,season_key,player_id),
  CONSTRAINT fk_trial_reset_snapshot_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_reset_snapshot_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_reset_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_TRIAL_TOWER_SEASON_RESET','trial_tower_season_reset','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/시련의탑시즌초기화','ADMIN_TRIAL_TOWER_SEASON_RESET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
