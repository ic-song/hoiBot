CREATE TABLE enhance_box_open_rate_versions (
  version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  min_reward BIGINT UNSIGNED NOT NULL,
  max_reward BIGINT UNSIGNED NOT NULL,
  max_open_count BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (version_code),
  KEY idx_enhance_box_rate_status_published (status, published_at),
  CONSTRAINT chk_enhance_box_rate_reward CHECK (min_reward > 0 AND max_reward >= min_reward),
  CONSTRAINT chk_enhance_box_rate_count CHECK (max_open_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enhance_box_open_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  rate_version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  opened_count BIGINT UNSIGNED NOT NULL,
  total_reward BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_enhance_box_execution_player_created (player_id, created_at),
  CONSTRAINT fk_enhance_box_execution_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_enhance_box_execution_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_enhance_box_execution_rate FOREIGN KEY (rate_version_code) REFERENCES enhance_box_open_rate_versions (version_code) ON DELETE RESTRICT,
  CONSTRAINT chk_enhance_box_execution_count CHECK (requested_count > 0 AND opened_count > 0 AND opened_count <= requested_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enhance_box_open_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  random_value DECIMAL(18,17) NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id, ordinal),
  CONSTRAINT fk_enhance_box_draw_operation FOREIGN KEY (operation_id) REFERENCES enhance_box_open_executions (operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_enhance_box_draw_ordinal CHECK (ordinal > 0),
  CONSTRAINT chk_enhance_box_draw_random CHECK (random_value >= 0 AND random_value <= 1),
  CONSTRAINT chk_enhance_box_draw_reward CHECK (reward_quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO enhance_box_open_rate_versions
  (version_code, min_reward, max_reward, max_open_count, status, published_at)
VALUES ('enhance-box-v1', 70, 100, 1000, 'published', '2026-08-25 00:00:00.000');
