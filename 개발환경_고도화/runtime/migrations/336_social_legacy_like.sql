CREATE TABLE IF NOT EXISTS social_like_global_locks (
  lock_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY(lock_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_like_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  usage_count_after BIGINT UNSIGNED NOT NULL,
  point_before DECIMAL(30,3) NOT NULL,
  point_after DECIMAL(30,3) NOT NULL,
  current_like_after BIGINT NOT NULL,
  lifetime_like_after BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY ix_social_like_actor_date(actor_player_id,usage_date),
  KEY ix_social_like_target_created(target_player_id,created_at),
  CONSTRAINT fk_social_like_event_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_event_actor FOREIGN KEY(actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_event_target FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_like_rank_snapshots (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  champion_player_id BIGINT UNSIGNED NULL,
  row_count BIGINT UNSIGNED NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_social_like_rank_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_rank_actor FOREIGN KEY(actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_rank_champion FOREIGN KEY(champion_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_social_like_rank_snapshot CHECK(JSON_VALID(snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_like_champion_markers (
  marker_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NULL,
  operation_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(marker_code),
  CONSTRAINT fk_social_like_marker_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_marker_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_like_reset_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  reset_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_player_id BIGINT UNSIGNED NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  affected_count BIGINT UNSIGNED NOT NULL,
  before_sum BIGINT NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_social_like_reset_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_reset_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_like_reset_target FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_social_like_reset_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO social_like_global_locks(lock_code,version) VALUES('LEGACY_LIKE',1)
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO social_like_champion_markers(marker_code,player_id,operation_id,version) VALUES('CURRENT',NULL,NULL,1)
ON DUPLICATE KEY UPDATE marker_code=VALUES(marker_code);

INSERT INTO admin_permissions(code,display_name) VALUES('social.legacy_like.reset','레거시 좋아요 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'social.legacy_like.reset' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('LEGACY_LIKE_MUTATE','legacy_social_like','VERIFIED_USER','SHADOW',TRUE,1),
('LEGACY_LIKE_COUNT_READ','legacy_social_like','VERIFIED_USER','SHADOW',TRUE,1),
('LEGACY_LIKE_RANK_READ','legacy_social_like','VERIFIED_USER','SHADOW',TRUE,1),
('LEGACY_LIKE_RESET','legacy_social_like','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/좋아요','LEGACY_LIKE_MUTATE',TRUE),
('/좋아요사용횟수','LEGACY_LIKE_COUNT_READ',TRUE),
('/좋아요순위','LEGACY_LIKE_RANK_READ',TRUE),
('/좋아리셋','LEGACY_LIKE_RESET',TRUE),
('/r','LEGACY_LIKE_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
