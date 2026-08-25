CREATE TABLE admin_adjustment_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  asset_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity_delta BIGINT NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_adjustment_operation_sequence (operation_id, sequence_no),
  KEY ix_admin_adjustment_target (target_player_id, created_at),
  CONSTRAINT fk_admin_adjustment_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_adjustment_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_adjustment_target FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
