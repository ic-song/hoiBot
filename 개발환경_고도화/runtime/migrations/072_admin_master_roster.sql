INSERT INTO admin_permissions(code, display_name)
VALUES
  ('admin.master.roster.read', '마스터 명단 조회'),
  ('admin.master.roster.revoke', '마스터 권한 회수')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles role
JOIN admin_permissions permission
  ON permission.code IN ('admin.master.roster.read', 'admin.master.roster.revoke')
WHERE role.code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
