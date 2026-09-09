CREATE TABLE IF NOT EXISTS castle_battle_member_adjustment_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  command_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  daily_record_date DATE NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  changed BOOLEAN NOT NULL,
  state_version_before BIGINT UNSIGNED NOT NULL,
  state_version_after BIGINT UNSIGNED NOT NULL,
  daily_version_before BIGINT UNSIGNED NOT NULL,
  daily_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_castle_member_adjustment_request (request_key),
  KEY idx_castle_member_adjustment_target (season_id,target_player_id,created_at),
  CONSTRAINT fk_castle_member_adjustment_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_castle_member_adjustment_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id),
  CONSTRAINT fk_castle_member_adjustment_season FOREIGN KEY (season_id) REFERENCES castle_battle_seasons(id),
  CONSTRAINT fk_castle_member_adjustment_player FOREIGN KEY (target_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS castle_battle_rank_snapshot_invalidations (
  operation_id BIGINT UNSIGNED NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invalidated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id,snapshot_id),
  KEY idx_castle_rank_invalidation_season (season_id,snapshot_id),
  CONSTRAINT fk_castle_rank_invalidation_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_castle_rank_invalidation_snapshot FOREIGN KEY (snapshot_id) REFERENCES castle_battle_rank_snapshots(id),
  CONSTRAINT fk_castle_rank_invalidation_season FOREIGN KEY (season_id) REFERENCES castle_battle_seasons(id),
  CONSTRAINT fk_castle_rank_invalidation_player FOREIGN KEY (target_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('game.castle_battle.manage','캐슬대전 운영 관리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'game.castle_battle.manage' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('CASTLE_BATTLE_ATTEMPT_SET','castle_battle_member_edit','VERIFIED_USER','SHADOW',1,1),
  ('CASTLE_BATTLE_SCORE_SET','castle_battle_member_edit','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/캐슬대전횟수리셋','CASTLE_BATTLE_ATTEMPT_SET',1),
  ('/캐슬스코어','CASTLE_BATTLE_SCORE_SET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
