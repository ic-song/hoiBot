CREATE TABLE home_follow_relationships (
  followed_player_id BIGINT UNSIGNED NOT NULL,
  follower_player_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  followed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (followed_player_id, follower_player_id),
  KEY idx_home_follow_follower_status (follower_player_id, status),
  CONSTRAINT fk_home_follow_followed_player FOREIGN KEY (followed_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_follow_follower_player FOREIGN KEY (follower_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_follow_status CHECK (status IN ('active', 'removed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_heart_expression_totals (
  player_id BIGINT UNSIGNED NOT NULL,
  cute_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  cheer_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  cool_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  love_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_home_heart_total_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_heart_total_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_definitions (
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (badge_code),
  KEY idx_home_badge_definition_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Legacy deletedBadgeIds are normalized as expired assignments; only active definitions and effective assignments rank.
