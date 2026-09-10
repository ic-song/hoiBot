INSERT INTO admin_permissions (code, display_name)
VALUES ('account.session.revoke', '사용자 세션 회수')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles role
JOIN admin_permissions permission ON permission.code = 'account.session.revoke'
WHERE role.code = 'super_admin' AND role.active = TRUE
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
