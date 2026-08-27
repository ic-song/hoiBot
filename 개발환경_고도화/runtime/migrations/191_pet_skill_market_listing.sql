START TRANSACTION;

CREATE TABLE market_skill_registration_confirmations (
  player_id BIGINT UNSIGNED NOT NULL,
  command_text VARCHAR(255) NOT NULL,
  player_pet_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  source_version BIGINT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_market_skill_confirmation_expiry (expires_at),
  CONSTRAINT fk_market_skill_confirmation_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_skill_confirmation_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_skill_confirmation_skill FOREIGN KEY (skill_id) REFERENCES skill_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_skill_confirmation_carrot FOREIGN KEY (carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_skill_registration_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  player_pet_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  skill_quantity_before BIGINT UNSIGNED NOT NULL,
  skill_quantity_after BIGINT UNSIGNED NOT NULL,
  source_version_before BIGINT UNSIGNED NOT NULL,
  source_version_after BIGINT UNSIGNED NOT NULL,
  carrot_version_before BIGINT UNSIGNED NOT NULL,
  carrot_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_market_skill_registration_listing (listing_id),
  CONSTRAINT fk_market_skill_registration_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_skill_registration_listing FOREIGN KEY (listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_skill_registration_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_skill_registration_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_skill_registration_skill FOREIGN KEY (skill_id) REFERENCES skill_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_skill_registration_carrot FOREIGN KEY (carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO market_registration_tier_policies(tier_code,can_register,minimum_legacy_tier) VALUES
('king',TRUE,'킹'),('emperor',TRUE,'킹'),('god',TRUE,'킹')
ON DUPLICATE KEY UPDATE can_register=VALUES(can_register),minimum_legacy_tier=VALUES(minimum_legacy_tier),updated_at=UTC_TIMESTAMP(3);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_MARKET_LISTING','pet_skill_market_listing','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/스킬거래등록 [가방번호] [수량] [판매금액]','PET_SKILL_MARKET_LISTING',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
