DELETE operator_role
FROM admin_operator_roles operator_role
JOIN admin_roles role ON role.id = operator_role.role_id
WHERE role.code = 'administrator';

DELETE FROM admin_roles WHERE code = 'administrator';

DELETE FROM admin_role_permissions
WHERE permission_code IN ('player.server.change', 'identity.approve');

DELETE FROM admin_permissions
WHERE code IN ('player.server.change', 'identity.approve');
