CREATE TABLE auction_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seller_player_id BIGINT UNSIGNED NULL,
  item_name VARCHAR(191) NOT NULL,
  highest_bidder_player_id BIGINT UNSIGNED NULL,
  highest_bid DECIMAL(30,3) UNSIGNED NOT NULL DEFAULT 0,
  ends_at DATETIME(3) NOT NULL,
  legacy_timeout_key VARCHAR(191) NULL,
  legacy_original_index BIGINT UNSIGNED NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_auction_listings_status_end (status,ends_at,id),
  KEY ix_auction_listings_seller (seller_player_id,status,id),
  KEY ix_auction_listings_bidder (highest_bidder_player_id,status,id),
  CONSTRAINT fk_auction_listing_seller FOREIGN KEY (seller_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_listing_bidder FOREIGN KEY (highest_bidder_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_auction_listing_status CHECK (status IN ('active','expired','sold','cancelled','reset'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auction_reset_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  reset_listing_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auction_reset_run_operation (operation_id),
  CONSTRAINT fk_auction_reset_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_reset_run_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auction_reset_lines (
  reset_run_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  previous_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(191) NOT NULL,
  highest_bidder_player_id BIGINT UNSIGNED NULL,
  highest_bid DECIMAL(30,3) UNSIGNED NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  legacy_timeout_key VARCHAR(191) NULL,
  legacy_original_index BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reset_run_id,sequence_no),
  UNIQUE KEY uq_auction_reset_line_listing (reset_run_id,listing_id),
  CONSTRAINT fk_auction_reset_line_run FOREIGN KEY (reset_run_id) REFERENCES auction_reset_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_reset_line_listing FOREIGN KEY (listing_id) REFERENCES auction_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_global_locks(lock_code) VALUES ('auction_reset')
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO admin_permissions(code,display_name) VALUES ('admin.auction.reset','경매 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.auction.reset' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_AUCTION_RESET','admin_auction_reset','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/경매초기화','ADMIN_AUCTION_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
