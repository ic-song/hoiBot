INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('enhance_rate_draw_ticket', '강화확률뽑기⚒️(/강화뽑기)', 'item', TRUE, JSON_OBJECT('slice', 'SL-SHOP-ENHANCE-RATE-DRAW'), TRUE, 1),
  ('spirit_enhance_rate_up_30', '정령강화확률UP🥀(30%)', 'item', TRUE, JSON_OBJECT('slice', 'SL-SHOP-ENHANCE-RATE-DRAW'), TRUE, 1),
  ('pet_enhance_rate_up_20', '펫강화확률UP🌟(20%)', 'item', TRUE, JSON_OBJECT('slice', 'SL-SHOP-ENHANCE-RATE-DRAW'), TRUE, 1),
  ('mini_pet_enhance_rate_up_30', '미니펫강화확률UP🐷(30%)', 'item', TRUE, JSON_OBJECT('slice', 'SL-SHOP-ENHANCE-RATE-DRAW'), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE;

CREATE TABLE enhance_rate_draw_versions (
  version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  max_draw_count BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (version_code),
  KEY idx_enhance_rate_version_status_published (status, published_at),
  CONSTRAINT chk_enhance_rate_version_count CHECK (max_draw_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enhance_rate_draw_rewards (
  version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  draw_order INT UNSIGNED NOT NULL,
  item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  upper_bound_bps INT UNSIGNED NOT NULL,
  output_sort INT UNSIGNED NOT NULL,
  PRIMARY KEY (version_code, draw_order),
  UNIQUE KEY uq_enhance_rate_version_item (version_code, item_code),
  CONSTRAINT fk_enhance_rate_reward_version FOREIGN KEY (version_code) REFERENCES enhance_rate_draw_versions (version_code) ON DELETE RESTRICT,
  CONSTRAINT fk_enhance_rate_reward_item FOREIGN KEY (item_code) REFERENCES item_definitions (code) ON DELETE RESTRICT,
  CONSTRAINT chk_enhance_rate_reward_bound CHECK (upper_bound_bps > 0 AND upper_bound_bps <= 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enhance_rate_draw_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  rate_version_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_enhance_rate_execution_player_created (player_id, created_at),
  CONSTRAINT fk_enhance_rate_execution_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_enhance_rate_execution_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_enhance_rate_execution_version FOREIGN KEY (rate_version_code) REFERENCES enhance_rate_draw_versions (version_code) ON DELETE RESTRICT,
  CONSTRAINT chk_enhance_rate_execution_count CHECK (requested_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enhance_rate_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  random_value DECIMAL(18,17) NOT NULL,
  reward_item_id BIGINT UNSIGNED NOT NULL,
  reward_code_snapshot VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (operation_id, ordinal),
  CONSTRAINT fk_enhance_rate_draw_operation FOREIGN KEY (operation_id) REFERENCES enhance_rate_draw_executions (operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_enhance_rate_draw_item FOREIGN KEY (reward_item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_enhance_rate_draw_ordinal CHECK (ordinal > 0),
  CONSTRAINT chk_enhance_rate_draw_random CHECK (random_value >= 0 AND random_value <= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO enhance_rate_draw_versions (version_code, max_draw_count, status, published_at)
VALUES ('enhance-rate-v1', 1000, 'published', '2026-08-25 00:00:00.000');

INSERT INTO enhance_rate_draw_rewards (version_code, draw_order, item_code, upper_bound_bps, output_sort)
VALUES
  ('enhance-rate-v1', 1, 'spirit_enhance_rate_up_30', 8000, 2),
  ('enhance-rate-v1', 2, 'pet_enhance_rate_up_20', 9000, 3),
  ('enhance-rate-v1', 3, 'mini_pet_enhance_rate_up_30', 10000, 1);
