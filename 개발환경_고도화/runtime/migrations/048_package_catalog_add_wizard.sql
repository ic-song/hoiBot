CREATE TABLE IF NOT EXISTS package_catalog_wizard_sessions (
  session_id VARCHAR(36) NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  flow_code VARCHAR(64) NOT NULL DEFAULT 'PACKAGE_CATALOG_ADD_WIZARD',
  state_code VARCHAR(32) NOT NULL,
  draft_json JSON NOT NULL,
  base_catalog_version BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('ACTIVE','CANCELLED','COMMITTED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  started_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  committed_package_id VARCHAR(128) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_package_catalog_wizard_operator_flow (operator_id, flow_code),
  KEY ix_package_catalog_wizard_active (status, expires_at),
  CONSTRAINT fk_package_catalog_wizard_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id),
  CONSTRAINT fk_package_catalog_wizard_package FOREIGN KEY (committed_package_id) REFERENCES package_catalog(package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_catalog_wizard_results (
  request_key VARCHAR(191) NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_key),
  KEY ix_package_catalog_wizard_result_operator (operator_id, created_at),
  CONSTRAINT fk_package_catalog_wizard_result_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('PACKAGE_CATALOG_WIZARD_GUIDE','PACKAGE_CATALOG_WIZARD_GUIDE','VERIFIED_USER','CANARY',1,1),
  ('PACKAGE_CATALOG_WIZARD_START','PACKAGE_CATALOG_WIZARD_START','VERIFIED_USER','CANARY',1,1),
  ('PACKAGE_CATALOG_WIZARD_CANCEL','PACKAGE_CATALOG_WIZARD_CANCEL','VERIFIED_USER','CANARY',1,1),
  ('PACKAGE_CATALOG_WIZARD_STATUS','PACKAGE_CATALOG_WIZARD_STATUS','VERIFIED_USER','CANARY',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/패키지추가방법','PACKAGE_CATALOG_WIZARD_GUIDE',1),
  ('/패키지추가시작','PACKAGE_CATALOG_WIZARD_START',1),
  ('/패키지추가취소','PACKAGE_CATALOG_WIZARD_CANCEL',1),
  ('/패키지추가상태','PACKAGE_CATALOG_WIZARD_STATUS',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

UPDATE package_item_definitions
SET enabled=1,
    metadata_json=JSON_SET(metadata_json, '$.packageWizardReward', TRUE),
    row_version=row_version+1
WHERE item_id='ITEM-RWD-011' AND item_type='POINT';
