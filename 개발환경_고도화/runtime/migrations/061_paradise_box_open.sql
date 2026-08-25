INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES ('paradise_point_box', '극락상자👹', 'item', TRUE, JSON_OBJECT('slice', 'SL-INVENTORY-PARADISE-BOX-OPEN'), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE;

CREATE TABLE paradise_box_open_rate_versions (
  version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  min_units BIGINT UNSIGNED NOT NULL,
  max_units BIGINT UNSIGNED NOT NULL,
  unit_point BIGINT UNSIGNED NOT NULL,
  max_open_count BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (version_code),
  KEY idx_paradise_box_rate_status_published (status, published_at),
  CONSTRAINT chk_paradise_box_rate_units CHECK (min_units > 0 AND max_units >= min_units),
  CONSTRAINT chk_paradise_box_rate_unit_point CHECK (unit_point > 0),
  CONSTRAINT chk_paradise_box_rate_count CHECK (max_open_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE paradise_box_open_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  rate_version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  opened_count BIGINT UNSIGNED NOT NULL,
  total_point DECIMAL(30,0) UNSIGNED NOT NULL,
  balance_before DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_paradise_box_execution_player_created (player_id, created_at),
  CONSTRAINT fk_paradise_box_execution_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_paradise_box_execution_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_paradise_box_execution_rate FOREIGN KEY (rate_version_code) REFERENCES paradise_box_open_rate_versions (version_code) ON DELETE RESTRICT,
  CONSTRAINT chk_paradise_box_execution_count CHECK (requested_count > 0 AND opened_count > 0 AND opened_count <= requested_count),
  CONSTRAINT chk_paradise_box_execution_point CHECK (total_point > 0 AND balance_after = balance_before + total_point)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE paradise_box_open_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  random_value DECIMAL(18,17) NOT NULL,
  reward_point BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id, ordinal),
  CONSTRAINT fk_paradise_box_draw_execution FOREIGN KEY (operation_id) REFERENCES paradise_box_open_executions (operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_paradise_box_draw_ordinal CHECK (ordinal > 0),
  CONSTRAINT chk_paradise_box_draw_random CHECK (random_value >= 0 AND random_value <= 1),
  CONSTRAINT chk_paradise_box_draw_point CHECK (reward_point > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE paradise_box_open_grants (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  balance_before DECIMAL(30,3) NOT NULL,
  amount DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_paradise_box_grant_player_created (player_id, created_at),
  CONSTRAINT fk_paradise_box_grant_execution FOREIGN KEY (operation_id) REFERENCES paradise_box_open_executions (operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_paradise_box_grant_account FOREIGN KEY (player_id, currency_code) REFERENCES currency_accounts (player_id, currency_code) ON DELETE RESTRICT,
  CONSTRAINT chk_paradise_box_grant_amount CHECK (amount > 0 AND balance_after = balance_before + amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO paradise_box_open_rate_versions
  (version_code, min_units, max_units, unit_point, max_open_count, status, published_at)
VALUES ('paradise-box-v1', 1, 10, 1000000, 1000, 'published', '2026-08-25 00:00:00.000');
