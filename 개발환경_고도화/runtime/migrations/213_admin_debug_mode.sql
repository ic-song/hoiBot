START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('diagnostic.debug_mode.toggle','디버깅 모드 변경')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'diagnostic.debug_mode.toggle' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

CREATE TABLE admin_debug_mode_instances (
  process_instance_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  toggled_by_operator_id BIGINT UNSIGNED NULL,
  last_operation_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(process_instance_id),
  CONSTRAINT fk_debug_mode_instance_operator FOREIGN KEY(toggled_by_operator_id) REFERENCES admin_operators(id),
  CONSTRAINT fk_debug_mode_instance_operation FOREIGN KEY(last_operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_debug_mode_mutations (
  request_key VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  process_instance_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  enabled_before BOOLEAN NOT NULL,
  enabled_after BOOLEAN NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(request_key),
  UNIQUE KEY uq_debug_mode_mutation_operation(operation_id),
  KEY idx_debug_mode_mutation_process_created(process_instance_id,created_at),
  CONSTRAINT fk_debug_mode_mutation_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_debug_mode_mutation_instance FOREIGN KEY(process_instance_id) REFERENCES admin_debug_mode_instances(process_instance_id),
  CONSTRAINT fk_debug_mode_mutation_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id),
  CONSTRAINT chk_debug_mode_mutation_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_DEBUG_MODE','ADMIN_DEBUG_MODE','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/디버깅모드','ADMIN_DEBUG_MODE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
