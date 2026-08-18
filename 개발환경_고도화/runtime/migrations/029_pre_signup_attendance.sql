CREATE TABLE pre_signup_attendance (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_identity_id BIGINT UNSIGNED NULL,
  legacy_display_name VARCHAR(191) NOT NULL,
  normalized_display_name VARCHAR(191) NOT NULL,
  attendance_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_attended_on DATE NULL,
  game_server_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  migrated_player_id BIGINT UNSIGNED NULL,
  source_import_run_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  migrated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pre_signup_attendance_identity (external_identity_id),
  KEY idx_pre_signup_attendance_name_status (normalized_display_name, status),
  KEY idx_pre_signup_attendance_status_date (status, last_attended_on),
  CONSTRAINT fk_pre_signup_attendance_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pre_signup_attendance_server FOREIGN KEY (game_server_id) REFERENCES game_servers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pre_signup_attendance_player FOREIGN KEY (migrated_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pre_signup_attendance_import FOREIGN KEY (source_import_run_id) REFERENCES legacy_import_runs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO attendance_programs (code, display_name, reset_policy_code, reward_rules_json, active)
VALUES ('legacy-light-attendance', '미가입 경량 출석', 'lifetime', NULL, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), reset_policy_code = VALUES(reset_policy_code), active = TRUE;
