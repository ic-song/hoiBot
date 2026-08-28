ALTER TABLE auction_listings
  ADD COLUMN settlement_operation_id BIGINT UNSIGNED NULL AFTER version,
  ADD KEY ix_auction_listing_settlement_operation (settlement_operation_id),
  ADD CONSTRAINT fk_auction_listing_settlement_operation FOREIGN KEY (settlement_operation_id) REFERENCES operations(id) ON DELETE RESTRICT;

CREATE TABLE auction_reward_catalog (
  reward_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  reward_type_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  title_id BIGINT UNSIGNED NULL,
  mini_pet_definition_id BIGINT UNSIGNED NULL,
  default_quantity BIGINT UNSIGNED NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (reward_code),
  CONSTRAINT fk_auction_reward_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_reward_title FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_reward_mini_pet FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_auction_reward_type CHECK (reward_type_code IN ('STACK','TITLE','PET_TITLE','PET_EXPERIENCE','MINI_PET','POINT')),
  CONSTRAINT ck_auction_reward_quantity CHECK (default_quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auction_listing_reward_rules (
  listing_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  reward_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NULL,
  PRIMARY KEY (listing_id,sequence_no),
  UNIQUE KEY uq_auction_listing_reward_code (listing_id,reward_code),
  CONSTRAINT fk_auction_listing_reward_listing FOREIGN KEY (listing_id) REFERENCES auction_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_listing_reward_catalog FOREIGN KEY (reward_code) REFERENCES auction_reward_catalog(reward_code) ON DELETE RESTRICT,
  CONSTRAINT ck_auction_listing_reward_quantity CHECK (quantity IS NULL OR quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auction_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  winner_player_id BIGINT UNSIGNED NULL,
  highest_bid DECIMAL(30,3) UNSIGNED NOT NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  listing_version_before BIGINT UNSIGNED NOT NULL,
  listing_version_after BIGINT UNSIGNED NOT NULL,
  settled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auction_settlement_listing (listing_id),
  CONSTRAINT fk_auction_settlement_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_settlement_listing FOREIGN KEY (listing_id) REFERENCES auction_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_settlement_winner FOREIGN KEY (winner_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_auction_settlement_result CHECK (result_code IN ('sold','no_bid'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auction_settlement_rewards (
  settlement_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  reward_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_type_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  mutation_summary_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (settlement_id,sequence_no),
  CONSTRAINT fk_auction_settlement_reward_settlement FOREIGN KEY (settlement_id) REFERENCES auction_settlements(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_settlement_reward_target FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_global_locks(lock_code) VALUES ('auction_settlement')
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('STORE_HOI_SHOP','store_hoi_shop','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/호이상점','STORE_HOI_SHOP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
