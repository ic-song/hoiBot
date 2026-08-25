INSERT INTO admin_permissions(code, display_name)
VALUES ('admin.role.assign', '관리자 역할 부여')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT id, 'admin.role.assign' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

CREATE TABLE admin_role_assignment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  target_operator_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_role_history_operation (operation_id),
  KEY ix_admin_role_history_target (target_operator_id, created_at),
  CONSTRAINT fk_admin_role_history_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_role_history_actor FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_role_history_target FOREIGN KEY (target_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_role_history_player FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_role_history_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_role_history_role FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE RESTRICT,
  CONSTRAINT ck_admin_role_history_action CHECK (action_code IN ('assigned','reaffirmed','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
