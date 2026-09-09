START TRANSACTION;

CREATE TABLE market_listing_registration_fees (
  listing_id BIGINT UNSIGNED NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(listing_id),
  CONSTRAINT fk_market_listing_fee_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_fee_item FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO market_listing_registration_fees(listing_id,carrot_item_id,carrot_fee,source_code)
SELECT listing_id,carrot_item_id,carrot_fee,'pendant' FROM market_pendant_registration_ledger;
INSERT IGNORE INTO market_listing_registration_fees(listing_id,carrot_item_id,carrot_fee,source_code)
SELECT listing_id,carrot_item_id,carrot_fee,'pet_skill' FROM market_skill_registration_ledger;
INSERT IGNORE INTO market_listing_registration_fees(listing_id,carrot_item_id,carrot_fee,source_code)
SELECT listing_id,carrot_item_id,carrot_fee,'furniture' FROM market_furniture_registration_ledger;

CREATE TABLE market_mini_pet_reservations (
  listing_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  reserved_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(listing_id),
  UNIQUE KEY uq_market_mini_pet_reservation_asset(owned_mini_pet_id),
  CONSTRAINT fk_market_mini_pet_reservation_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_reservation_asset FOREIGN KEY(owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_reservation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_listing_cancellations (
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  seller_player_id BIGINT UNSIGNED NOT NULL,
  asset_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_quantity BIGINT UNSIGNED NOT NULL,
  refunded_carrot_item_id BIGINT UNSIGNED NULL,
  refunded_carrot_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  listing_version_before BIGINT UNSIGNED NOT NULL,
  listing_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  UNIQUE KEY uq_market_listing_cancellation_listing(listing_id),
  CONSTRAINT fk_market_listing_cancellation_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_cancellation_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_cancellation_seller FOREIGN KEY(seller_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_listing_cancellation_refund_item FOREIGN KEY(refunded_carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MARKET_FREE_MARKET_CANCEL','free_market_cancel','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/자유시장취소 [번호]','MARKET_FREE_MARKET_CANCEL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
