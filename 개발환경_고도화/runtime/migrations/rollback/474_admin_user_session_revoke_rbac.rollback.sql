DELETE role_permission
FROM admin_role_permissions role_permission
JOIN admin_roles role ON role.id = role_permission.role_id
WHERE role.code = 'super_admin'
  AND role_permission.permission_code = 'account.session.revoke';

DELETE FROM admin_permissions
WHERE code = 'account.session.revoke';
