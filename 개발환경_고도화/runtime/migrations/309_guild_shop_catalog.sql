START TRANSACTION;

INSERT INTO configuration_sets(set_code,version,status,effective_from)
SELECT 'guild_shop_catalog',1,'active',UTC_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM configuration_sets WHERE set_code='guild_shop_catalog' AND version=1);

CREATE TABLE guild_shop_catalog_state (
  singleton_id TINYINT UNSIGNED NOT NULL,
  configuration_set_id BIGINT UNSIGNED NOT NULL,
  catalog_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(singleton_id),
  CONSTRAINT ck_guild_shop_catalog_singleton CHECK(singleton_id=1),
  CONSTRAINT fk_guild_shop_catalog_configuration FOREIGN KEY(configuration_set_id) REFERENCES configuration_sets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO guild_shop_catalog_state(singleton_id,configuration_set_id,catalog_version)
SELECT 1,id,1 FROM configuration_sets WHERE set_code='guild_shop_catalog' AND version=1
ON DUPLICATE KEY UPDATE configuration_set_id=VALUES(configuration_set_id);

CREATE TABLE guild_shop_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  display_name VARCHAR(191) NOT NULL,
  price DECIMAL(30,0) NOT NULL,
  daily_limit INT UNSIGNED NULL,
  display_order INT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_guild_shop_product_id(product_id),
  UNIQUE KEY uq_guild_shop_display_name(display_name),
  KEY ix_guild_shop_active_order(enabled,display_order,id),
  CONSTRAINT fk_guild_shop_item_definition FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_guild_shop_price CHECK(price>0),
  CONSTRAINT ck_guild_shop_daily_limit CHECK(daily_limit IS NULL OR daily_limit>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_shop_catalog_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version_before BIGINT UNSIGNED NOT NULL,
  catalog_version_after BIGINT UNSIGNED NOT NULL,
  previous_json JSON NULL,
  current_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_guild_shop_catalog_event_operation(operation_id),
  KEY ix_guild_shop_catalog_event_product(product_id,id),
  CONSTRAINT fk_guild_shop_catalog_event_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('GUILD_SHOP_LIST','guild_shop_catalog','VERIFIED_USER','SHADOW',TRUE,1),
  ('GUILD_SHOP_ADD','guild_shop_catalog','VERIFIED_USER','SHADOW',TRUE,1),
  ('GUILD_SHOP_DELETE','guild_shop_catalog','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/길드상점','GUILD_SHOP_LIST',TRUE),
  ('/길드상점추가','GUILD_SHOP_ADD',TRUE),
  ('/길드상점삭제','GUILD_SHOP_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
