START TRANSACTION;

ALTER TABLE furniture_inventory_instances MODIFY status ENUM('bag','placed','listed','sold','removed') NOT NULL DEFAULT 'bag';

CREATE TABLE market_furniture_registration_confirmations (
  player_id BIGINT UNSIGNED NOT NULL,
  command_text VARCHAR(255) NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  furniture_definition_id BIGINT UNSIGNED NOT NULL,
  charm_snapshot BIGINT UNSIGNED NOT NULL,
  grade_display_name VARCHAR(128) NOT NULL,
  instance_ids_json JSON NOT NULL,
  instance_versions_json JSON NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(player_id),
  KEY idx_market_furniture_confirmation_expiry(expires_at),
  CONSTRAINT fk_market_furniture_confirmation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_furniture_confirmation_definition FOREIGN KEY(furniture_definition_id) REFERENCES furniture_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_furniture_confirmation_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_furniture_registration_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  furniture_definition_id BIGINT UNSIGNED NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL,
  carrot_fee BIGINT UNSIGNED NOT NULL,
  carrot_version_before BIGINT UNSIGNED NOT NULL,
  carrot_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  UNIQUE KEY uq_market_furniture_registration_listing(listing_id),
  CONSTRAINT fk_market_furniture_registration_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_furniture_registration_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_furniture_registration_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_furniture_registration_definition FOREIGN KEY(furniture_definition_id) REFERENCES furniture_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_furniture_registration_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_furniture_registration_items (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  furniture_instance_id BIGINT UNSIGNED NOT NULL,
  source_version_before BIGINT UNSIGNED NOT NULL,
  source_version_after BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  UNIQUE KEY uq_market_furniture_registration_instance(furniture_instance_id),
  CONSTRAINT fk_market_furniture_item_operation FOREIGN KEY(operation_id) REFERENCES market_furniture_registration_ledger(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_furniture_item_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_FURNITURE_MARKET_LISTING','home_furniture_market_listing','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/가구거래등록 [가구가방번호] [수량] [판매금액]','HOME_FURNITURE_MARKET_LISTING',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
