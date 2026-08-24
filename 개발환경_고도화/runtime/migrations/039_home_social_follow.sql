ALTER TABLE home_badge_definitions
  ADD COLUMN criteria_json JSON NULL AFTER active;

CREATE TABLE home_activity_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  alert_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mutual BOOLEAN NOT NULL DEFAULT FALSE,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_home_alert_target_read_created (target_player_id, read_at, created_at, id),
  KEY idx_home_alert_operation (operation_id),
  CONSTRAINT fk_home_alert_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_alert_target FOREIGN KEY (target_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_alert_actor FOREIGN KEY (actor_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_alert_badge FOREIGN KEY (badge_code) REFERENCES home_badge_definitions (badge_code) ON DELETE RESTRICT,
  CONSTRAINT chk_home_alert_type CHECK (alert_type IN ('follow', 'unfollow', 'badge_earned'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
