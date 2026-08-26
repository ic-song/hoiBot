CREATE TABLE IF NOT EXISTS player_check_counts (
  player_id BIGINT UNSIGNED NOT NULL,
  check_count DECIMAL(30,0) UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_player_check_counts_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT chk_player_check_counts_nonnegative CHECK (check_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_global_locks (
  lock_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (lock_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_check_count_reset_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  affected_player_count INT UNSIGNED NOT NULL,
  total_before DECIMAL(30,0) UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_admin_check_count_reset_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_admin_check_count_reset_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_global_locks(lock_code)
VALUES ('auth_check_count_reset')
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO admin_permissions(code,display_name)
VALUES ('admin.check_count.reset','인증 횟수 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.check_count.reset' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_AUTH_CHECK_COUNT_RESET','admin_auth_check_count_reset','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/인증초기화','ADMIN_AUTH_CHECK_COUNT_RESET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
