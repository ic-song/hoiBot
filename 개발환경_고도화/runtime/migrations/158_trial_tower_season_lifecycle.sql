START TRANSACTION;

CREATE TABLE trial_tower_season_transitions (
  operation_id BIGINT UNSIGNED NOT NULL,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_active BOOLEAN NOT NULL,
  changed_active BOOLEAN NOT NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_trial_season_transition_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_season_transition_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_TRIAL_TOWER_SEASON_START','trial_tower_season_lifecycle','VERIFIED_USER','SHADOW',1,1),
       ('ADMIN_TRIAL_TOWER_SEASON_END','trial_tower_season_lifecycle','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/시련의탑시즌시작','ADMIN_TRIAL_TOWER_SEASON_START',1),
       ('/시련의탑시즌종료','ADMIN_TRIAL_TOWER_SEASON_END',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
