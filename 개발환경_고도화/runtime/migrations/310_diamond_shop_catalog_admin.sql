START TRANSACTION;

INSERT INTO configuration_sets(set_code,version,status,effective_from)
SELECT 'diamond_shop_catalog',1,'active',UTC_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM configuration_sets WHERE set_code='diamond_shop_catalog' AND version=1);

CREATE TABLE diamond_shop_catalog_state (
  singleton_id TINYINT UNSIGNED NOT NULL,
  configuration_set_id BIGINT UNSIGNED NOT NULL,
  catalog_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  bootstrap_source VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bootstrap_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bootstrap_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(singleton_id),
  CONSTRAINT ck_diamond_shop_catalog_singleton CHECK(singleton_id=1),
  CONSTRAINT ck_diamond_shop_bootstrap_status CHECK(bootstrap_status IN ('pending_seed','seeded','verified')),
  CONSTRAINT fk_diamond_shop_catalog_configuration FOREIGN KEY(configuration_set_id) REFERENCES configuration_sets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO diamond_shop_catalog_state(singleton_id,configuration_set_id,catalog_version,bootstrap_source,bootstrap_version,bootstrap_status)
SELECT 1,id,1,'legacy.defaultShop','WBS-GATE1-20260823','pending_seed'
FROM configuration_sets WHERE set_code='diamond_shop_catalog' AND version=1
ON DUPLICATE KEY UPDATE configuration_set_id=VALUES(configuration_set_id);

CREATE TABLE diamond_shop_catalog_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  reward_quantity DECIMAL(30,0) NOT NULL,
  diamond_price DECIMAL(30,0) NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_diamond_shop_product_id(product_id),
  KEY ix_diamond_shop_active_order(enabled,display_order,id),
  CONSTRAINT ck_diamond_shop_quantity CHECK(reward_quantity>=0),
  CONSTRAINT ck_diamond_shop_price CHECK(diamond_price>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE diamond_shop_catalog_events (
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
  UNIQUE KEY uq_diamond_shop_event_operation(operation_id),
  KEY ix_diamond_shop_event_product(product_id,id),
  CONSTRAINT fk_diamond_shop_event_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('DIAMOND_SHOP_CATALOG_ADD','diamond_shop_catalog_admin','VERIFIED_USER','SHADOW',TRUE,1),
  ('DIAMOND_SHOP_CATALOG_DELETE','diamond_shop_catalog_admin','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/다이아상점추가','DIAMOND_SHOP_CATALOG_ADD',TRUE),
  ('/다이아상점삭제','DIAMOND_SHOP_CATALOG_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
