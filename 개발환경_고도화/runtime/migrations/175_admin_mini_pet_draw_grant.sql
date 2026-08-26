START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('mini_pet_draw','미니펫뽑기🐹(/미니펫오픈)','STACK',TRUE,
       JSON_OBJECT('source','legacy-main.js','objectKey','mini_pet_draw','legacyItemId','ITEM-PACKAGE-105','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name)
VALUES('inventory.mini_pet_draw.grant','미니펫뽑기 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.mini_pet_draw.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_MINI_PET_DRAW_GRANT','admin_mini_pet_draw_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫미니','ADMIN_MINI_PET_DRAW_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
