ALTER TABLE auction_reward_catalog
  ADD COLUMN bid_inventory_cap BIGINT UNSIGNED NULL AFTER default_quantity;

CREATE TABLE auction_bid_policy (
  policy_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bid_fee DECIMAL(30,3) UNSIGNED NOT NULL,
  extension_threshold_seconds INT UNSIGNED NOT NULL,
  extension_seconds INT UNSIGNED NOT NULL,
  PRIMARY KEY (policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO auction_bid_policy VALUES ('default',700000,60,60);

CREATE TABLE auction_bids (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  bidder_player_id BIGINT UNSIGNED NOT NULL,
  previous_bidder_player_id BIGINT UNSIGNED NULL,
  bid_amount DECIMAL(30,3) UNSIGNED NOT NULL,
  fee_amount DECIMAL(30,3) UNSIGNED NOT NULL,
  previous_bid_amount DECIMAL(30,3) UNSIGNED NOT NULL,
  bidder_balance_before DECIMAL(30,3) NOT NULL,
  bidder_balance_after DECIMAL(30,3) NOT NULL,
  previous_balance_before DECIMAL(30,3) NULL,
  previous_balance_after DECIMAL(30,3) NULL,
  listing_version_before BIGINT UNSIGNED NOT NULL,
  listing_version_after BIGINT UNSIGNED NOT NULL,
  ends_at_before DATETIME(3) NOT NULL,
  ends_at_after DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auction_bid_operation (operation_id),
  KEY ix_auction_bid_listing_created (listing_id,created_at,id),
  CONSTRAINT fk_auction_bid_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_bid_listing FOREIGN KEY (listing_id) REFERENCES auction_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_bid_bidder FOREIGN KEY (bidder_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_bid_previous_bidder FOREIGN KEY (previous_bidder_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO admin_global_locks(lock_code) VALUES ('auction_bid') ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('STORE_AUCTION_BID','store_auction_bid','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/입찰','STORE_AUCTION_BID',TRUE),('/입찰 [아이템번호] [포인트]','STORE_AUCTION_BID',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
