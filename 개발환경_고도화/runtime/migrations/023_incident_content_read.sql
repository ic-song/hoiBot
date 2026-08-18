INSERT INTO admin_permissions (code, display_name) VALUES
  ('incident.content.read', '삭제·가리기 원문 실시간 조회')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles AS role
JOIN admin_permissions AS permission ON permission.code = 'incident.content.read'
WHERE role.code IN ('super_admin', 'manager')
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
