START TRANSACTION;

ALTER TABLE diamond_shop_catalog_items
  ADD COLUMN reward_item_id BIGINT UNSIGNED NULL AFTER display_name,
  ADD CONSTRAINT fk_diamond_shop_catalog_reward_item
    FOREIGN KEY (reward_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT;

CREATE TABLE diamond_shop_purchase_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  reward_item_id BIGINT UNSIGNED NULL,
  purchase_count BIGINT UNSIGNED NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  diamond_spent DECIMAL(30,0) NOT NULL,
  diamond_balance_after DECIMAL(30,0) NOT NULL,
  catalog_version BIGINT UNSIGNED NOT NULL,
  status_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_memo VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_diamond_shop_purchase_operation(operation_id),
  KEY ix_diamond_shop_purchase_player(player_id,created_at),
  KEY ix_diamond_shop_purchase_product(product_id,created_at),
  CONSTRAINT fk_diamond_shop_purchase_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_diamond_shop_purchase_product FOREIGN KEY(product_id) REFERENCES diamond_shop_catalog_items(product_id) ON DELETE RESTRICT,
  CONSTRAINT fk_diamond_shop_purchase_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_diamond_shop_purchase_item FOREIGN KEY(reward_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_diamond_shop_purchase_status CHECK(status_code IN ('purchased','insufficient_diamond','unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('DIAMOND_SHOP_BUY','DIAMOND_SHOP_BUY','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/다이아상점구매','DIAMOND_SHOP_BUY',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
