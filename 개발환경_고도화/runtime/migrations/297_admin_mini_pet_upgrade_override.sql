START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('mini_pet.enhancement.override','미니펫 강화 수치 절대값 변경')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'mini_pet.enhancement.override' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_MINI_PET_UPGRADE_OVERRIDE','admin_mini_pet_upgrade_override','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫강화속성','ADMIN_MINI_PET_UPGRADE_OVERRIDE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
