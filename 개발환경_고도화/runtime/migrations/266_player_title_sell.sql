START TRANSACTION;

CREATE TABLE IF NOT EXISTS player_title_sale_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  sale_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_start BIGINT UNSIGNED NOT NULL,
  source_end BIGINT UNSIGNED NOT NULL,
  sold_count BIGINT UNSIGNED NOT NULL,
  total_gain DECIMAL(30,3) NOT NULL,
  point_before DECIMAL(30,3) NOT NULL,
  point_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_player_title_sales_player (player_id, created_at),
  CONSTRAINT fk_player_title_sales_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_title_sales_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_title_sale_lines (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  source_display_order BIGINT UNSIGNED NOT NULL,
  was_equipped BOOLEAN NOT NULL,
  acquisition_price DECIMAL(30,3) NOT NULL,
  sale_price DECIMAL(30,3) NOT NULL,
  PRIMARY KEY (operation_id, sequence_no),
  KEY idx_player_title_sale_lines_title (title_id),
  CONSTRAINT fk_player_title_sale_lines_operation FOREIGN KEY (operation_id) REFERENCES player_title_sale_operations(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_title_sale_lines_title FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('PLAYER_TITLE_SELL_SINGLE','player_title_sell','VERIFIED_USER','SHADOW',TRUE,1),
  ('PLAYER_TITLE_SELL_RANGE','player_title_sell','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/타이틀판매','PLAYER_TITLE_SELL_SINGLE',TRUE),
  ('/타이틀지정판매','PLAYER_TITLE_SELL_RANGE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
