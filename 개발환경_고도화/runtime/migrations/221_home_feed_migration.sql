START TRANSACTION;

CREATE TABLE home_feeds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  home_player_id BIGINT UNSIGNED NOT NULL,
  feed_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content LONGTEXT NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  created_at_ms BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_operation_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_home_feed_key (home_player_id,feed_key),
  KEY idx_home_feed_order (home_player_id,deleted_at,display_order,id),
  CONSTRAINT fk_home_feed_home FOREIGN KEY (home_player_id) REFERENCES player_homes(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_source_operation FOREIGN KEY (source_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_feed_legacy_sources (
  player_id BIGINT UNSIGNED NOT NULL,
  legacy_content LONGTEXT NULL,
  legacy_created_at_ms BIGINT UNSIGNED NULL,
  source_import_run_id BIGINT UNSIGNED NULL,
  source_file VARCHAR(500) NULL,
  source_path VARCHAR(1000) NULL,
  migrated_operation_id BIGINT UNSIGNED NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  migrated_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_id),
  KEY idx_home_feed_legacy_import (source_import_run_id),
  KEY idx_home_feed_legacy_migrated (migrated_operation_id),
  CONSTRAINT fk_home_feed_legacy_home FOREIGN KEY (player_id) REFERENCES player_homes(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_legacy_import FOREIGN KEY (source_import_run_id) REFERENCES legacy_import_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_legacy_operation FOREIGN KEY (migrated_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_feed_migration_state (
  migration_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  completed_operation_id BIGINT UNSIGNED NULL,
  completed_by_operator_id BIGINT UNSIGNED NULL,
  completed_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (migration_key),
  UNIQUE KEY uq_home_feed_migration_completed_operation (completed_operation_id),
  CONSTRAINT fk_home_feed_migration_state_operation FOREIGN KEY (completed_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_migration_state_operator FOREIGN KEY (completed_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_feed_migration_state(migration_key) VALUES('feedMigration20260728');

CREATE TABLE home_feed_migration_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  migration_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_count BIGINT UNSIGNED NOT NULL,
  legacy_feed_count BIGINT UNSIGNED NOT NULL,
  backed_up_source_count BIGINT UNSIGNED NOT NULL,
  backed_up_feed_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_feed_migration_run_actor (actor_operator_id,created_at),
  CONSTRAINT fk_home_feed_migration_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_migration_run_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_feed_migration_source_backups (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  source_present BOOLEAN NOT NULL,
  legacy_content LONGTEXT NULL,
  legacy_created_at_ms BIGINT UNSIGNED NULL,
  source_import_run_id BIGINT UNSIGNED NULL,
  source_file VARCHAR(500) NULL,
  source_path VARCHAR(1000) NULL,
  PRIMARY KEY (operation_id,player_id),
  CONSTRAINT fk_home_feed_source_backup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_feed_migration_feed_backups (
  operation_id BIGINT UNSIGNED NOT NULL,
  feed_id BIGINT UNSIGNED NOT NULL,
  home_player_id BIGINT UNSIGNED NOT NULL,
  feed_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content LONGTEXT NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  created_at_ms BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_operation_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(3) NULL,
  feed_version BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,feed_id),
  CONSTRAINT fk_home_feed_backup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_feed_migration_markers (
  player_id BIGINT UNSIGNED NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  had_legacy_feed BOOLEAN NOT NULL,
  migrated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_home_feed_marker_operation (operation_id),
  CONSTRAINT fk_home_feed_marker_home FOREIGN KEY (player_id) REFERENCES player_homes(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_marker_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_FEED_MIGRATION','home_feed_migration','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫홈피드마이그레이션','HOME_FEED_MIGRATION',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
