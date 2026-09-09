CREATE TABLE IF NOT EXISTS admin_server_stat_snapshot_sets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  database_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_at DATETIME(3) NOT NULL,
  active_member_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_admin_server_stat_environment (environment_code,id),
  CONSTRAINT fk_admin_server_stat_environment FOREIGN KEY (environment_code) REFERENCES legacy_snapshot_environments(environment_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_server_stat_snapshot_rows (
  snapshot_set_id BIGINT UNSIGNED NOT NULL,
  server_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  server_display_name VARCHAR(191) NOT NULL,
  active_member_count BIGINT UNSIGNED NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (snapshot_set_id,server_code),
  UNIQUE KEY uq_admin_server_stat_order (snapshot_set_id,display_order),
  CONSTRAINT fk_admin_server_stat_snapshot_set FOREIGN KEY (snapshot_set_id) REFERENCES admin_server_stat_snapshot_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_server_stat_read_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  snapshot_set_id BIGINT UNSIGNED NOT NULL,
  request_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_admin_server_stat_execution_snapshot (snapshot_set_id),
  CONSTRAINT fk_admin_server_stat_execution_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_server_stat_execution_snapshot FOREIGN KEY (snapshot_set_id) REFERENCES admin_server_stat_snapshot_sets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('stats.server.read','활성 회원 서버 통계 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'stats.server.read' FROM admin_roles WHERE code='super_admin' AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_SERVER_STATS','admin_server_stats','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/서버통계','ADMIN_SERVER_STATS',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
