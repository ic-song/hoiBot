START TRANSACTION;

CREATE TABLE trial_tower_sync_removals (
  operation_id BIGINT UNSIGNED NOT NULL,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  member_key VARCHAR(191) NOT NULL,
  floor BIGINT UNSIGNED NOT NULL,
  last_win_at DATETIME(3) NULL,
  progress_version BIGINT UNSIGNED NOT NULL,
  removed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,season_key,player_id),
  CONSTRAINT fk_trial_sync_removal_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_sync_removal_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_TRIAL_TOWER_SYNC','trial_tower_sync','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/시련의탑동기화','ADMIN_TRIAL_TOWER_SYNC',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
