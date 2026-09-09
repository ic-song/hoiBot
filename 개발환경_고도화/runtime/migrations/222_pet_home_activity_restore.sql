CREATE TABLE IF NOT EXISTS pet_home_activity_restore_sources (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_path VARCHAR(500) NOT NULL,
  source_root_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (backup_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_alerts (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  alert_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_external_user_id VARCHAR(191) NOT NULL,
  created_at_text VARCHAR(64) NOT NULL,
  read_flag BOOLEAN NOT NULL,
  preview_text VARCHAR(500) NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_name VARCHAR(191) NULL,
  feed_key VARCHAR(191) NULL,
  feed_content VARCHAR(1000) NULL,
  mutual_flag BOOLEAN NULL,
  aggregate_count BIGINT UNSIGNED NULL,
  PRIMARY KEY (backup_key, owner_external_user_id, sequence_no),
  CONSTRAINT fk_home_activity_source_alert_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_visitors (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  visitor_external_user_id VARCHAR(191) NOT NULL,
  visited_at_text VARCHAR(64) NOT NULL,
  PRIMARY KEY (backup_key, owner_external_user_id, sequence_no),
  CONSTRAINT fk_home_activity_source_visitor_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_social (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  heart_usage_date VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  heart_used_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  equipped_badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  followers_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mutual_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_comments BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_home_likes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_reactions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_visits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (backup_key, owner_external_user_id),
  CONSTRAINT fk_home_activity_source_social_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_relations (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  direction_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  related_external_user_id VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  PRIMARY KEY (backup_key, owner_external_user_id, direction_code, related_external_user_id),
  CONSTRAINT chk_home_activity_source_relation_direction CHECK (direction_code IN ('followers','following')),
  CONSTRAINT fk_home_activity_source_relation_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_badges (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  collection_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  PRIMARY KEY (backup_key, owner_external_user_id, collection_code, badge_code),
  CONSTRAINT chk_home_activity_source_badge_collection CHECK (collection_code IN ('owned','deleted')),
  CONSTRAINT fk_home_activity_source_badge_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_feed_days (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  activity_date DATE NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  PRIMARY KEY (backup_key, owner_external_user_id, activity_date),
  CONSTRAINT fk_home_activity_source_feed_day_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_special_logs (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_external_user_id VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_external_user_id VARCHAR(191) NOT NULL,
  created_at_text VARCHAR(64) NOT NULL,
  PRIMARY KEY (backup_key, owner_external_user_id, sequence_no),
  CONSTRAINT fk_home_activity_source_special_log_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_source_migrations (
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  migration_key VARCHAR(191) NOT NULL,
  value_json JSON NOT NULL,
  PRIMARY KEY (backup_key, migration_key),
  CONSTRAINT fk_home_activity_source_migration_backup FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_alerts (
  owner_player_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  alert_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  created_at_text VARCHAR(64) NOT NULL,
  read_flag BOOLEAN NOT NULL,
  preview_text VARCHAR(500) NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_name VARCHAR(191) NULL,
  feed_key VARCHAR(191) NULL,
  feed_content VARCHAR(1000) NULL,
  mutual_flag BOOLEAN NULL,
  aggregate_count BIGINT UNSIGNED NULL,
  restored_operation_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (owner_player_id, sequence_no),
  KEY idx_pet_home_activity_alert_actor (actor_player_id),
  CONSTRAINT fk_pet_home_activity_alert_owner FOREIGN KEY (owner_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_home_activity_alert_actor FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_home_activity_alert_operation FOREIGN KEY (restored_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_recent_visitors (
  owner_player_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  visitor_player_id BIGINT UNSIGNED NOT NULL,
  visited_at_text VARCHAR(64) NOT NULL,
  restored_operation_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (owner_player_id, sequence_no),
  KEY idx_pet_home_recent_visitor_player (visitor_player_id),
  CONSTRAINT fk_pet_home_recent_visitor_owner FOREIGN KEY (owner_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_home_recent_visitor_player FOREIGN KEY (visitor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_home_recent_visitor_operation FOREIGN KEY (restored_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_special_badge_logs (
  player_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_external_user_id VARCHAR(191) NOT NULL,
  created_at_text VARCHAR(64) NOT NULL,
  restored_operation_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (player_id, sequence_no),
  CONSTRAINT fk_pet_home_special_log_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_home_special_log_operation FOREIGN KEY (restored_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_migration_markers (
  migration_key VARCHAR(191) NOT NULL,
  value_json JSON NOT NULL,
  restored_operation_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (migration_key),
  CONSTRAINT fk_pet_home_activity_marker_operation FOREIGN KEY (restored_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_backups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  entity_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_key VARCHAR(500) NOT NULL,
  row_json JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_home_activity_restore_backup_operation (operation_id, entity_code),
  CONSTRAINT fk_home_activity_restore_backup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_activity_restore_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  legacy_import_run_id BIGINT UNSIGNED NULL,
  backup_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  restored_user_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  restored_alert_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  restored_visitor_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  backup_row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_home_activity_restore_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_activity_restore_run_import FOREIGN KEY (legacy_import_run_id) REFERENCES legacy_import_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_activity_restore_run_source FOREIGN KEY (backup_key) REFERENCES pet_home_activity_restore_sources(backup_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_ACTIVITY_RESTORE','home_activity_restore','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫홈활동살리기','HOME_ACTIVITY_RESTORE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
