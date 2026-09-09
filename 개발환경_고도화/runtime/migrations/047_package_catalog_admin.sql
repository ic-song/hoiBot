ALTER TABLE package_catalog
  ADD COLUMN description TEXT NOT NULL DEFAULT '' AFTER display_name,
  ADD COLUMN display_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER consume_item_id,
  ADD COLUMN block_castle BOOLEAN NOT NULL DEFAULT FALSE AFTER max_open_count,
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER row_version,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL AFTER deleted_at;

CREATE TEMPORARY TABLE package_catalog_order_seed AS
SELECT package_id, ROW_NUMBER() OVER (ORDER BY display_name, package_id) AS display_order
FROM package_catalog;

UPDATE package_catalog catalog
JOIN package_catalog_order_seed seed ON seed.package_id = catalog.package_id
SET catalog.display_order = seed.display_order;

DROP TEMPORARY TABLE package_catalog_order_seed;

CREATE INDEX idx_package_catalog_projection
  ON package_catalog(deleted_at, display_order, package_id);

CREATE TABLE package_catalog_heads (
  catalog_key VARCHAR(64) NOT NULL PRIMARY KEY,
  version BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)
) ENGINE=InnoDB;

INSERT INTO package_catalog_heads(catalog_key,version,updated_by)
VALUES ('PACKAGE_CATALOG', 1, NULL);

CREATE TABLE package_catalog_mutations (
  request_key VARCHAR(191) NOT NULL PRIMARY KEY,
  operation_id BIGINT UNSIGNED NOT NULL UNIQUE,
  command_code VARCHAR(128) NOT NULL,
  package_id VARCHAR(64) NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  catalog_version BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_package_catalog_mutation_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT chk_package_catalog_mutation_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB;

INSERT INTO admin_permissions(code,display_name)
VALUES ('package.catalog.manage','패키지 카탈로그 관리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('PACKAGE_CATALOG_ADD','PACKAGE_CATALOG_ADD','VERIFIED_USER','CANARY',1,1),
  ('PACKAGE_CATALOG_EDIT','PACKAGE_CATALOG_EDIT','VERIFIED_USER','CANARY',1,1),
  ('PACKAGE_CATALOG_REMOVE','PACKAGE_CATALOG_REMOVE','VERIFIED_USER','CANARY',1,1),
  ('PACKAGE_CATALOG_ENABLE','PACKAGE_CATALOG_ENABLE','VERIFIED_USER','CANARY',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/패키지추가','PACKAGE_CATALOG_ADD',1),
  ('/패키지수정','PACKAGE_CATALOG_EDIT',1),
  ('/패키지제거','PACKAGE_CATALOG_REMOVE',1),
  ('/패키지리스트제거','PACKAGE_CATALOG_REMOVE',1),
  ('/패키지활성','PACKAGE_CATALOG_ENABLE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
