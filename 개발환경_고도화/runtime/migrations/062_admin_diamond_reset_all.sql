CREATE TABLE IF NOT EXISTS admin_currency_reset_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator_id BIGINT UNSIGNED NOT NULL,
  confirmation_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_event_id VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  consumed_event_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_currency_reset_request (request_event_id),
  UNIQUE KEY uq_admin_currency_reset_operation (operation_id),
  KEY idx_admin_currency_reset_code (operator_id,confirmation_code,expires_at,consumed_at),
  CONSTRAINT fk_admin_currency_reset_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id),
  CONSTRAINT fk_admin_currency_reset_operation FOREIGN KEY(operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('game.currency.reset_all','전체 재화 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'game.currency.reset_all' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO currency_definitions(code,display_name,scale_digits,active)
VALUES ('diamond','다이아',0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scale_digits=VALUES(scale_digits),active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_DIAMOND_RESET_ALL','admin_diamond_reset_all','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/다이아전체초기화','ADMIN_DIAMOND_RESET_ALL',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
