CREATE TABLE market_fee_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount DECIMAL(30,3) NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_market_fee_ledger_operation (operation_id),
  KEY idx_market_fee_ledger_currency_created (currency_code, created_at),
  CONSTRAINT fk_market_fee_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_fee_ledger_listing FOREIGN KEY (listing_id) REFERENCES market_listings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_fee_ledger_currency FOREIGN KEY (currency_code) REFERENCES currency_definitions (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
