START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('game.castle_battle.manage','캐슬 대전 시즌 관리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'game.castle_battle.manage' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

CREATE TABLE castle_battle_season_state (
  scope_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_season_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(scope_key),
  UNIQUE KEY uq_castle_battle_season_state_active(active_season_id),
  CONSTRAINT fk_castle_battle_season_state_active FOREIGN KEY(active_season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO castle_battle_season_state(scope_key,active_season_id,version)
SELECT 'GLOBAL',(SELECT id FROM castle_battle_seasons WHERE status='active' ORDER BY starts_at DESC,id DESC LIMIT 1),1
ON DUPLICATE KEY UPDATE scope_key=VALUES(scope_key);

CREATE TABLE castle_battle_season_start_runs (
  request_key VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  baseline_snapshot_id BIGINT UNSIGNED NULL,
  initialized_player_count BIGINT UNSIGNED NOT NULL,
  reset_tier_count BIGINT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(request_key),
  UNIQUE KEY uq_castle_battle_season_start_operation(operation_id),
  UNIQUE KEY uq_castle_battle_season_start_season(season_id),
  CONSTRAINT fk_castle_battle_season_start_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_season_start_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_season_start_season FOREIGN KEY(season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_season_start_snapshot FOREIGN KEY(baseline_snapshot_id) REFERENCES castle_battle_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT chk_castle_battle_season_start_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_battle_season_start_player_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  previous_season_id BIGINT UNSIGNED NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  previous_tier_point INT UNSIGNED NULL,
  tier_point INT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,player_id),
  CONSTRAINT fk_castle_battle_season_start_player_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_season_start_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_season_start_player_previous FOREIGN KEY(previous_season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_season_start_player_season FOREIGN KEY(season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_battle_scheduled_transitions (
  transition_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  transition_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_for DATETIME(3) NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(transition_key),
  UNIQUE KEY uq_castle_battle_transition_operation(operation_id,transition_code),
  KEY ix_castle_battle_transition_due(status,scheduled_for),
  CONSTRAINT fk_castle_battle_transition_season FOREIGN KEY(season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_transition_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('CASTLE_BATTLE_SEASON_START','castle_battle_season_start','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/캐슬대전시즌시작','CASTLE_BATTLE_SEASON_START',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
