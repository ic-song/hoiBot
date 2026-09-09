START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('inventory.slot_newbie_package.grant','슬롯초보 패키지 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.slot_newbie_package.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_SLOT_NEWBIE_PACKAGE_GRANT','admin_slot_newbie_package_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/슬롯초보','ADMIN_SLOT_NEWBIE_PACKAGE_GRANT',1),
('/슬롯초보2','ADMIN_SLOT_NEWBIE_PACKAGE_GRANT',1),
('/슬롯초보3','ADMIN_SLOT_NEWBIE_PACKAGE_GRANT',1),
('/슬롯초보4','ADMIN_SLOT_NEWBIE_PACKAGE_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
