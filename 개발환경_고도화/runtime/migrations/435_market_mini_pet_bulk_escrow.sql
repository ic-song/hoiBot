START TRANSACTION;

ALTER TABLE market_mini_pet_reservations
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (listing_id,owned_mini_pet_id);

CREATE TABLE market_mini_pet_transfer_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  seller_player_id BIGINT UNSIGNED NOT NULL,
  buyer_player_id BIGINT UNSIGNED NOT NULL,
  version_before BIGINT UNSIGNED NOT NULL,
  version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,sequence_no),
  UNIQUE KEY uq_market_mini_pet_transfer_asset (listing_id,owned_mini_pet_id),
  CONSTRAINT fk_market_mini_pet_transfer_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_transfer_listing FOREIGN KEY (listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_transfer_asset FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_transfer_seller FOREIGN KEY (seller_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_transfer_buyer FOREIGN KEY (buyer_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
