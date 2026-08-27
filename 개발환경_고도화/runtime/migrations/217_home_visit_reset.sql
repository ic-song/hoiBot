START TRANSACTION;

ALTER TABLE player_homes
  ADD COLUMN visit_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER like_count;

UPDATE player_homes home
LEFT JOIN (
  SELECT home_player_id,COUNT(*) visit_count
  FROM home_visits
  GROUP BY home_player_id
) history ON history.home_player_id=home.player_id
SET home.visit_count=COALESCE(history.visit_count,0);

CREATE TABLE home_visit_reset_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  reset_home_count BIGINT UNSIGNED NOT NULL,
  reset_visit_total BIGINT UNSIGNED NOT NULL,
  preserved_visit_rows BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_visit_reset_actor_created (actor_operator_id,created_at),
  CONSTRAINT fk_home_visit_reset_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_visit_reset_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_VISIT_RESET','home_visit_reset','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫홈방문초기화','HOME_VISIT_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
