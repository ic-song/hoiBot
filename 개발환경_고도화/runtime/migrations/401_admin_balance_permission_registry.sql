START TRANSACTION;

INSERT INTO admin_permissions(code, display_name)
VALUES ('admin.balance.manage', '확률·수치 관리')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles AS role
JOIN admin_permissions AS permission ON permission.code = 'admin.balance.manage'
WHERE role.active = TRUE
  AND role.code IN ('super_admin', 'manager')
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);

COMMIT;
