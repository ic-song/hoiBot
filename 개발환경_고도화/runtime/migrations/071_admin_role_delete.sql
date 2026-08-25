INSERT INTO admin_permissions(code, display_name)
VALUES ('admin.role.revoke', '관리자 역할 회수')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT id, 'admin.role.revoke' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
