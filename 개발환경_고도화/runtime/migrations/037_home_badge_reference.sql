CREATE TABLE home_badge_reference_versions (
  id BIGINT UNSIGNED NOT NULL,
  version_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_home_badge_reference_version_key (version_key),
  KEY idx_home_badge_reference_active (status, effective_at, id),
  CONSTRAINT chk_home_badge_reference_status CHECK (status IN ('draft', 'published', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_options (
  reference_version_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  option_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  max_percent DECIMAL(5,1) NOT NULL,
  PRIMARY KEY (reference_version_id, sequence_no),
  UNIQUE KEY uq_home_badge_cube_option_code (reference_version_id, option_code),
  CONSTRAINT fk_home_badge_cube_option_version FOREIGN KEY (reference_version_id)
    REFERENCES home_badge_reference_versions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_badge_cube_option_sequence CHECK (sequence_no >= 1),
  CONSTRAINT chk_home_badge_cube_option_max CHECK (max_percent > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_rate_bands (
  reference_version_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  min_percent DECIMAL(5,1) NOT NULL,
  max_percent DECIMAL(5,1) NOT NULL,
  rate_percent DECIMAL(12,6) NOT NULL,
  PRIMARY KEY (reference_version_id, sequence_no),
  UNIQUE KEY uq_home_badge_cube_band_range (reference_version_id, min_percent, max_percent),
  CONSTRAINT fk_home_badge_cube_band_version FOREIGN KEY (reference_version_id)
    REFERENCES home_badge_reference_versions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_badge_cube_band_sequence CHECK (sequence_no >= 1),
  CONSTRAINT chk_home_badge_cube_band_range CHECK (min_percent >= 0 AND max_percent >= min_percent),
  CONSTRAINT chk_home_badge_cube_band_rate CHECK (rate_percent >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_gacha_grade_rates (
  reference_version_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  grade_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rate_percent DECIMAL(8,4) NOT NULL,
  badge_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (reference_version_id, sequence_no),
  UNIQUE KEY uq_home_badge_gacha_grade (reference_version_id, grade_code),
  CONSTRAINT fk_home_badge_gacha_grade_version FOREIGN KEY (reference_version_id)
    REFERENCES home_badge_reference_versions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_badge_gacha_grade_sequence CHECK (sequence_no >= 1),
  CONSTRAINT chk_home_badge_gacha_grade_rate CHECK (rate_percent >= 0 AND rate_percent <= 100),
  CONSTRAINT chk_home_badge_gacha_badge_count CHECK (badge_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_special_definitions (
  reference_version_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  badge_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  emoji_value VARCHAR(32) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  acquisition_text VARCHAR(255) NOT NULL,
  PRIMARY KEY (reference_version_id, sequence_no),
  UNIQUE KEY uq_home_badge_special_code (reference_version_id, badge_code),
  CONSTRAINT fk_home_badge_special_version FOREIGN KEY (reference_version_id)
    REFERENCES home_badge_reference_versions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_badge_special_sequence CHECK (sequence_no >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Published rows are immutable snapshots. A new configuration creates a new version and complete child set.
