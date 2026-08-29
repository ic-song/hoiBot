START TRANSACTION;

CREATE TABLE guild_membership_reconciliation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_count INT UNSIGNED NOT NULL,
  membership_count INT UNSIGNED NOT NULL,
  assigned_count INT UNSIGNED NOT NULL,
  unassigned_count INT UNSIGNED NOT NULL,
  missing_profile_count INT UNSIGNED NOT NULL,
  changed_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_membership_reconcile_hash (source_hash),
  UNIQUE KEY uq_guild_membership_reconcile_operation (operation_id),
  CONSTRAINT fk_guild_membership_reconcile_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_membership_projections (
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NULL,
  source_run_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_guild_membership_projection_guild (guild_id),
  CONSTRAINT fk_guild_membership_projection_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_membership_projection_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_membership_projection_run FOREIGN KEY (source_run_id) REFERENCES guild_membership_reconciliation_runs(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_membership_reconciliation_snapshots (
  run_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NULL,
  profile_missing BOOLEAN NOT NULL,
  PRIMARY KEY (run_id,player_id),
  CONSTRAINT fk_guild_membership_snapshot_run FOREIGN KEY (run_id) REFERENCES guild_membership_reconciliation_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_membership_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_membership_snapshot_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_membership_reconciliation_deltas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  before_guild_id BIGINT UNSIGNED NULL,
  after_guild_id BIGINT UNSIGNED NULL,
  change_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_membership_delta_run_player (run_id,player_id),
  CONSTRAINT fk_guild_membership_delta_run FOREIGN KEY (run_id) REFERENCES guild_membership_reconciliation_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_membership_delta_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_membership_delta_before_guild FOREIGN KEY (before_guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_membership_delta_after_guild FOREIGN KEY (after_guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES('guild.membership.reconcile','길드 소속 데이터 동기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'guild.membership.reconcile' FROM admin_roles WHERE code IN ('administrator','manager','super_admin')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_GUILD_MEMBERSHIP_SYNC','admin_guild_membership_sync','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/길드데이터동기화','ADMIN_GUILD_MEMBERSHIP_SYNC',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
