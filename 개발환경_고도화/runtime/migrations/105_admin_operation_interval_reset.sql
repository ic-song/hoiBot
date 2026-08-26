CREATE TABLE IF NOT EXISTS operation_interval_control (
  control_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cancellation_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active_interval_count INT UNSIGNED NOT NULL DEFAULT 0,
  previous_interval_marker BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (control_code),
  CONSTRAINT fk_operation_interval_control_operator FOREIGN KEY (updated_by_operator_id) REFERENCES admin_operators(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operation_interval_room_scopes (
  provider_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  destination_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider_code, destination_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operation_interval_reset_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  before_json LONGTEXT NOT NULL,
  after_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_operation_interval_reset_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_operation_interval_reset_before CHECK (JSON_VALID(before_json)),
  CONSTRAINT chk_operation_interval_reset_after CHECK (JSON_VALID(after_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO operation_interval_control(control_code)
VALUES ('legacy_exploration')
ON DUPLICATE KEY UPDATE control_code=VALUES(control_code);

INSERT INTO admin_global_locks(lock_code) VALUES ('operation_interval_reset')
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO admin_permissions(code,display_name)
VALUES ('admin.operation_interval.reset','운영 주기 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.operation_interval.reset' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_OPERATION_INTERVAL_RESET','admin_operation_interval_reset','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/주기리셋','ADMIN_OPERATION_INTERVAL_RESET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
