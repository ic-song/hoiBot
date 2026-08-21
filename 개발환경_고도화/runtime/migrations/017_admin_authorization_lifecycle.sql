ALTER TABLE user_accounts
  ADD COLUMN account_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'normal' AFTER gender_code,
  ADD CONSTRAINT chk_user_accounts_account_type CHECK (account_type IN ('normal', 'test'));

CREATE TABLE admin_operator_permission_overrides (
  operator_id BIGINT UNSIGNED NOT NULL,
  permission_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effect VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  granted_by BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operator_id, permission_code),
  CONSTRAINT chk_admin_permission_override_effect CHECK (effect IN ('allow', 'deny')),
  CONSTRAINT fk_admin_permission_override_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_permission_override_permission FOREIGN KEY (permission_code) REFERENCES admin_permissions (code) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_permission_override_granter FOREIGN KEY (granted_by) REFERENCES admin_operators (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_auth_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator_id BIGINT UNSIGNED NULL,
  login_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  event_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_auth_events_operator_created (operator_id, created_at),
  KEY idx_admin_auth_events_code_created (event_code, created_at),
  CONSTRAINT fk_admin_auth_event_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_auth_event_session FOREIGN KEY (session_id) REFERENCES admin_sessions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_restrictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  restriction_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  reason VARCHAR(500) NOT NULL,
  starts_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  ends_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  revoked_by BIGINT UNSIGNED NULL,
  revoked_reason VARCHAR(500) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_player_restrictions_active (player_id, status, ends_at),
  CONSTRAINT chk_player_restriction_type CHECK (restriction_type IN ('temporary_suspension', 'permanent_suspension')),
  CONSTRAINT chk_player_restriction_status CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT fk_player_restriction_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_restriction_creator FOREIGN KEY (created_by) REFERENCES admin_operators (id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_restriction_revoker FOREIGN KEY (revoked_by) REFERENCES admin_operators (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE account_deletion_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_account_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'grace_period',
  requested_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  scheduled_delete_at DATETIME(3) NOT NULL,
  recovered_at DATETIME(3) NULL,
  recovered_by_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recovered_by_id BIGINT UNSIGNED NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  active_user_account_id BIGINT UNSIGNED AS (CASE WHEN status IN ('grace_period', 'processing', 'failed') THEN user_account_id ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_deletion_active (active_user_account_id),
  KEY idx_account_deletion_schedule (status, scheduled_delete_at),
  CONSTRAINT chk_account_deletion_status CHECK (status IN ('grace_period', 'recovered', 'processing', 'completed', 'failed')),
  CONSTRAINT fk_account_deletion_account FOREIGN KEY (user_account_id) REFERENCES user_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_deletion_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE account_cleanup_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deletion_request_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_no INT UNSIGNED NOT NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_cleanup_attempt (deletion_request_id, attempt_no),
  KEY idx_account_cleanup_status (status, started_at),
  CONSTRAINT fk_account_cleanup_request FOREIGN KEY (deletion_request_id) REFERENCES account_deletion_requests (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_pass_admin_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  pass_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permanent BOOLEAN NOT NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_pass_admin_idempotency (operator_id, idempotency_key),
  KEY idx_player_pass_admin_history (player_id, pass_code, created_at),
  CONSTRAINT fk_player_pass_history_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_pass_history_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions (code, display_name) VALUES
  ('overview.read', '대시보드 조회'),
  ('player.server.assign', '회원 서버 배정'),
  ('identity.read', '외부 식별자 조회'),
  ('identity.assign', '외부 식별자 연결'),
  ('account.restrict', '계정 제재'),
  ('account.deletion.manage', '계정 탈퇴 관리'),
  ('pass.read', '프리패스 조회'),
  ('pass.grant', '프리패스 지급'),
  ('pass.revoke', '프리패스 회수'),
  ('operator.read', '운영자 조회'),
  ('operator.manage', '운영자 관리'),
  ('authorization.manage', '권한 관리')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_roles (code, display_name, active) VALUES
  ('super_admin', '최고관리자', TRUE),
  ('manager', '매니저', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE;

INSERT INTO admin_operator_roles (operator_id, role_id)
SELECT operator_role.operator_id, super_role.id
FROM admin_operator_roles operator_role
JOIN admin_roles legacy_role ON legacy_role.id = operator_role.role_id AND legacy_role.code = 'administrator'
JOIN admin_roles super_role ON super_role.code = 'super_admin'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

UPDATE admin_roles SET active = FALSE WHERE code = 'administrator';

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code FROM admin_roles role CROSS JOIN admin_permissions permission
WHERE role.code = 'super_admin'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code FROM admin_roles role JOIN admin_permissions permission
  ON permission.code IN ('overview.read', 'player.read', 'identity.read', 'audit.read', 'pass.read', 'operator.read')
WHERE role.code = 'manager'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
