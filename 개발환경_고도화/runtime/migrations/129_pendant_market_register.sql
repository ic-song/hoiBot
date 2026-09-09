START TRANSACTION;

CREATE TABLE market_registration_tier_policies (
  tier_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  can_register BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_legacy_tier VARCHAR(32) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (tier_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_registration_confirmations (
  player_id BIGINT UNSIGNED NOT NULL,
  command_text VARCHAR(255) NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL,
  instance_version BIGINT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_market_registration_confirmation_expiry (expires_at),
  CONSTRAINT fk_market_confirmation_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_confirmation_instance FOREIGN KEY (inventory_instance_id) REFERENCES inventory_instances(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_pendant_registration_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL,
  source_index INT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  instance_version_before BIGINT UNSIGNED NOT NULL,
  instance_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_market_pendant_registration_listing (listing_id),
  CONSTRAINT fk_market_pendant_registration_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_pendant_registration_listing FOREIGN KEY (listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_pendant_registration_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_pendant_registration_instance FOREIGN KEY (inventory_instance_id) REFERENCES inventory_instances(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_pendant_registration_carrot FOREIGN KEY (carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO market_registration_tier_policies(tier_code,can_register,minimum_legacy_tier) VALUES
('king',TRUE,'킹'),('emperor',TRUE,'킹'),('god',TRUE,'킹')
ON DUPLICATE KEY UPDATE can_register=VALUES(can_register),minimum_legacy_tier=VALUES(minimum_legacy_tier),updated_at=UTC_TIMESTAMP(3);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PENDANT_MARKET_REGISTER','pendant_market_register','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펜던트거래등록','PENDANT_MARKET_REGISTER',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
