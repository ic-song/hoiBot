CREATE TABLE point_shop_catalog_heads (
  catalog_key VARCHAR(64) NOT NULL PRIMARY KEY,
  version BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO point_shop_catalog_heads(catalog_key,version,updated_by)
VALUES ('POINT_SHOP',1,NULL);

CREATE TABLE point_shop_catalog (
  product_id VARCHAR(64) NOT NULL PRIMARY KEY,
  product_key VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
  display_name VARCHAR(191) NOT NULL,
  price DECIMAL(30,0) UNSIGNED NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  catalog_version BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  deleted_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_point_shop_display_name(display_name),
  KEY idx_point_shop_projection(enabled,deleted_at,display_order,product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_state (
  state_code VARCHAR(64) NOT NULL PRIMARY KEY,
  tax_rate_basis_points INT UNSIGNED NOT NULL DEFAULT 0,
  lord_guild_name VARCHAR(191) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_castle_state_tax CHECK (tax_rate_basis_points <= 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO castle_state(state_code,tax_rate_basis_points,lord_guild_name,version)
VALUES ('HOI_CASTLE',0,NULL,1);

CREATE TABLE point_shop_catalog_mutations (
  request_key VARCHAR(191) NOT NULL PRIMARY KEY,
  operation_id BIGINT UNSIGNED NOT NULL UNIQUE,
  command_code VARCHAR(128) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  catalog_version BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_point_shop_mutation_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT chk_point_shop_mutation_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name)
VALUES ('point_shop.catalog.manage','포인트 상점 카탈로그 관리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('POINT_SHOP_CATALOG_READ','POINT_SHOP_CATALOG_READ','VERIFIED_USER','SHADOW',1,1),
  ('POINT_SHOP_CATALOG_UPSERT','POINT_SHOP_CATALOG_UPSERT','VERIFIED_USER','SHADOW',1,1),
  ('POINT_SHOP_CATALOG_REMOVE','POINT_SHOP_CATALOG_REMOVE','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/상점','POINT_SHOP_CATALOG_READ',1),
  ('/상점추가','POINT_SHOP_CATALOG_UPSERT',1),
  ('/상점삭제','POINT_SHOP_CATALOG_REMOVE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
