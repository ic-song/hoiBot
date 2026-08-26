CREATE TABLE IF NOT EXISTS request_monitor_config (
  id TINYINT UNSIGNED NOT NULL,
  window_ms BIGINT UNSIGNED NOT NULL,
  limit_count BIGINT UNSIGNED NOT NULL,
  excluded_commands_json LONGTEXT NOT NULL,
  excluded_rooms_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_request_monitor_config_operator FOREIGN KEY (updated_by_operator_id) REFERENCES admin_operators(id),
  CONSTRAINT chk_request_monitor_config_singleton CHECK (id = 1),
  CONSTRAINT chk_request_monitor_config_window CHECK (window_ms > 0),
  CONSTRAINT chk_request_monitor_config_commands CHECK (JSON_VALID(excluded_commands_json)),
  CONSTRAINT chk_request_monitor_config_rooms CHECK (JSON_VALID(excluded_rooms_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_monitor_config_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  config_id TINYINT UNSIGNED NOT NULL,
  before_json LONGTEXT NOT NULL,
  after_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_request_monitor_config_mutation_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_request_monitor_config_mutation_config FOREIGN KEY (config_id) REFERENCES request_monitor_config(id),
  CONSTRAINT chk_request_monitor_config_before CHECK (JSON_VALID(before_json)),
  CONSTRAINT chk_request_monitor_config_after CHECK (JSON_VALID(after_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO request_monitor_config(id,window_ms,limit_count,excluded_commands_json,excluded_rooms_json,version)
VALUES (1,2000,4,'[]','[]',1)
ON DUPLICATE KEY UPDATE id=VALUES(id);

INSERT INTO admin_permissions(code,display_name)
VALUES ('admin.request_monitor.configure','요청 감지 설정 조회·변경')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.request_monitor.configure' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_REQUEST_MONITOR_CONFIG','admin_request_monitor_config','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/요청설정','ADMIN_REQUEST_MONITOR_CONFIG',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
