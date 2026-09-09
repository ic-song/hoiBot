START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('inventory.rocket_package.grant','로켓배송 패키지 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.rocket_package.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_ROCKET_PACKAGE_GRANT','admin_rocket_package_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/로켓1','ADMIN_ROCKET_PACKAGE_GRANT',1),('/로켓2','ADMIN_ROCKET_PACKAGE_GRANT',1),
('/로켓3','ADMIN_ROCKET_PACKAGE_GRANT',1),('/로켓4','ADMIN_ROCKET_PACKAGE_GRANT',1),
('/로켓5','ADMIN_ROCKET_PACKAGE_GRANT',1),('/로켓6','ADMIN_ROCKET_PACKAGE_GRANT',1),
('/로켓7','ADMIN_ROCKET_PACKAGE_GRANT',1),('/로켓8','ADMIN_ROCKET_PACKAGE_GRANT',1),
('/로켓9','ADMIN_ROCKET_PACKAGE_GRANT',1),('/로켓10','ADMIN_ROCKET_PACKAGE_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
