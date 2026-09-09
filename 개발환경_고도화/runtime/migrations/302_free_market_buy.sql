START TRANSACTION;

CREATE TABLE free_market_buy_policy (
  policy_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  confirmation_seconds INT UNSIGNED NOT NULL,
  standard_fee_basis_points INT UNSIGNED NOT NULL,
  member_fee_basis_points INT UNSIGNED NOT NULL,
  stack_slot_limit BIGINT UNSIGNED NOT NULL,
  mini_pet_bag_limit BIGINT UNSIGNED NOT NULL,
  furniture_base_limit BIGINT UNSIGNED NOT NULL,
  furniture_premium_bonus BIGINT UNSIGNED NOT NULL,
  pet_skill_bag_limit BIGINT UNSIGNED NOT NULL,
  pendant_bag_limit BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO free_market_buy_policy VALUES('default',60,1000,500,100,100,10,5,100,50);

CREATE TABLE free_market_buy_confirmations (
  player_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  listing_version BIGINT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  requested_event_id VARCHAR(191) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  consumed_event_id VARCHAR(191) NULL,
  cancelled_at DATETIME(3) NULL,
  cancelled_event_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(player_id),
  KEY idx_free_market_buy_confirmation_expiry(expires_at),
  CONSTRAINT fk_free_market_buy_confirmation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_free_market_buy_confirmation_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE free_market_buy_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  buyer_player_id BIGINT UNSIGNED NOT NULL,
  seller_player_id BIGINT UNSIGNED NOT NULL,
  asset_type_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_quantity BIGINT UNSIGNED NOT NULL,
  gross_amount DECIMAL(30,3) NOT NULL,
  fee_basis_points INT UNSIGNED NOT NULL,
  fee_amount DECIMAL(30,3) NOT NULL,
  seller_net_amount DECIMAL(30,3) NOT NULL,
  listing_version_before BIGINT UNSIGNED NOT NULL,
  listing_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  UNIQUE KEY uq_free_market_buy_event_listing(listing_id),
  CONSTRAINT fk_free_market_buy_event_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_free_market_buy_event_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_free_market_buy_event_buyer FOREIGN KEY(buyer_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_free_market_buy_event_seller FOREIGN KEY(seller_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MARKET_FREE_MARKET_BUY','free_market_buy','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/자유시장구매 [번호]','MARKET_FREE_MARKET_BUY',TRUE),
('자유시장거래','MARKET_FREE_MARKET_BUY',TRUE),
('자유시장거래취소','MARKET_FREE_MARKET_BUY',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
