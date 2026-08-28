ALTER TABLE auction_listings
  ADD COLUMN reward_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER item_name,
  ADD COLUMN normalized_item_key VARCHAR(191) NOT NULL DEFAULT '' AFTER reward_code,
  ADD COLUMN active_item_key VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN status='active' THEN normalized_item_key ELSE NULL END) STORED,
  ADD COLUMN duration_minutes BIGINT UNSIGNED NULL AFTER legacy_original_index,
  ADD COLUMN created_by_operator_id BIGINT UNSIGNED NULL AFTER duration_minutes,
  ADD UNIQUE KEY uq_auction_listing_active_item_key (active_item_key),
  ADD CONSTRAINT fk_auction_listing_reward_code FOREIGN KEY (reward_code) REFERENCES auction_reward_catalog(reward_code) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auction_listing_operator FOREIGN KEY (created_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT;

CREATE TABLE auction_registration_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  reward_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_name VARCHAR(191) NOT NULL,
  normalized_item_key VARCHAR(191) NOT NULL,
  duration_minutes BIGINT UNSIGNED NOT NULL,
  legacy_original_index BIGINT UNSIGNED NOT NULL,
  listing_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auction_registration_operation (operation_id),
  UNIQUE KEY uq_auction_registration_listing (listing_id),
  CONSTRAINT fk_auction_registration_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_registration_listing FOREIGN KEY (listing_id) REFERENCES auction_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_registration_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_auction_registration_reward FOREIGN KEY (reward_code) REFERENCES auction_reward_catalog(reward_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO admin_global_locks(lock_code) VALUES ('auction_register') ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);
INSERT INTO admin_permissions(code,display_name) VALUES ('auction.register','경매 등록') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'auction.register' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES ('STORE_AUCTION_REGISTER','store_auction_register','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/경매등록','STORE_AUCTION_REGISTER',TRUE),('/경매등록 [아이템명] [분]','STORE_AUCTION_REGISTER',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
