CREATE TABLE IF NOT EXISTS home_badge_permanent_deletions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  definition_version_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  selection_text VARCHAR(128) NOT NULL,
  owned_ordinal INT UNSIGNED NULL,
  assignment_removed BOOLEAN NOT NULL DEFAULT FALSE,
  tombstone_written BOOLEAN NOT NULL DEFAULT FALSE,
  cube_removed BOOLEAN NOT NULL DEFAULT FALSE,
  equipment_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_badge_delete_player_created (player_id, created_at),
  CONSTRAINT fk_home_badge_delete_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_badge_delete_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_delete_definition_version FOREIGN KEY (definition_version_id) REFERENCES home_badge_definition_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_BADGE_PERMANENT_DELETE','home_badge_permanent_delete','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE
  handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),
  enabled=VALUES(enabled),version=GREATEST(version,VALUES(version)),updated_at=UTC_TIMESTAMP(3);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/홈뱃지삭제','HOME_BADGE_PERMANENT_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
