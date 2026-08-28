CREATE TABLE IF NOT EXISTS admin_support_grant_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  target_count INT UNSIGNED NOT NULL,
  request_json LONGTEXT NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_support_grant_event_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_grant_event_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_grant_event_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_support_grant_event_request CHECK (JSON_VALID(request_json)),
  CONSTRAINT chk_support_grant_event_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_support_grant_targets (
  operation_id BIGINT UNSIGNED NOT NULL,
  target_order INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,player_id),
  UNIQUE KEY uq_support_grant_target_order (operation_id,target_order),
  CONSTRAINT fk_support_grant_target_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_grant_target_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('inventory.support.grant','후원 아이템 일괄 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.support.grant' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('SUPPORT_GRANT_MANUAL','support_grant_manual','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/후원지급','SUPPORT_GRANT_MANUAL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
