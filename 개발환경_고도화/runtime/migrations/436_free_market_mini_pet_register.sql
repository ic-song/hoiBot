START TRANSACTION;

CREATE TABLE market_mini_pet_registration_confirmations (
  player_id BIGINT UNSIGNED NOT NULL, command_text VARCHAR(255) NOT NULL,
  source_index BIGINT UNSIGNED NOT NULL, quantity BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL, custom_name VARCHAR(191) NULL, custom_emoji VARCHAR(191) NULL,
  enhancement_level BIGINT UNSIGNED NOT NULL, battle_experience BIGINT UNSIGNED NOT NULL,
  castle_experience BIGINT UNSIGNED NOT NULL, raid_experience BIGINT UNSIGNED NOT NULL, is_elite BOOLEAN NOT NULL,
  owned_ids_json JSON NOT NULL, owned_versions_json JSON NOT NULL, price_amount DECIMAL(30,3) NOT NULL,
  carrot_item_id BIGINT UNSIGNED NOT NULL, carrot_fee BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(player_id), KEY idx_market_mini_pet_confirmation_expiry(expires_at),
  CONSTRAINT fk_market_mini_pet_confirmation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_mini_pet_confirmation_definition FOREIGN KEY(mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_confirmation_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_mini_pet_registration_ledger (
  operation_id BIGINT UNSIGNED NOT NULL, listing_id BIGINT UNSIGNED NOT NULL, player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL, source_index BIGINT UNSIGNED NOT NULL, quantity BIGINT UNSIGNED NOT NULL,
  price_amount DECIMAL(30,3) NOT NULL, carrot_item_id BIGINT UNSIGNED NOT NULL, carrot_fee BIGINT UNSIGNED NOT NULL,
  owned_ids_json JSON NOT NULL, owned_versions_json JSON NOT NULL,
  carrot_version_before BIGINT UNSIGNED NOT NULL, carrot_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id), UNIQUE KEY uq_market_mini_pet_registration_listing(listing_id),
  CONSTRAINT fk_market_mini_pet_registration_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_registration_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_registration_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_registration_definition FOREIGN KEY(mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_mini_pet_registration_carrot FOREIGN KEY(carrot_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MARKET_MINIPET_TRADE_REGISTER','free_market_mini_pet_register','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/미니펫거래등록','MARKET_MINIPET_TRADE_REGISTER',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
