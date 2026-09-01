START TRANSACTION;

CREATE TABLE guild_shop_daily_purchases (
  player_id BIGINT UNSIGNED NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purchase_date DATE NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY(player_id,product_id,purchase_date),
  CONSTRAINT fk_guild_shop_daily_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_shop_daily_product FOREIGN KEY(product_id) REFERENCES guild_shop_items(product_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_shop_purchases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  base_price DECIMAL(30,0) NOT NULL,
  tax_amount DECIMAL(30,0) NOT NULL,
  total_price DECIMAL(30,0) NOT NULL,
  guild_fund_amount DECIMAL(30,0) NOT NULL,
  foundation_amount DECIMAL(30,0) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  purchased_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_guild_shop_purchase_operation(operation_id),
  KEY ix_guild_shop_purchase_player(player_id,purchased_at,id),
  CONSTRAINT fk_guild_shop_purchase_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_shop_purchase_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_shop_purchase_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_shop_purchase_product FOREIGN KEY(product_id) REFERENCES guild_shop_items(product_id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_shop_purchase_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE guild_shop_items shop
JOIN item_definitions item ON item.display_name=shop.display_name AND item.active=TRUE
SET shop.item_id=item.id
WHERE shop.item_id IS NULL;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_SHOP_PURCHASE','guild_shop_purchase','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/길드상점구매','GUILD_SHOP_PURCHASE',TRUE),
  ('/길드상점구매 [번호] [갯수]','GUILD_SHOP_PURCHASE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
