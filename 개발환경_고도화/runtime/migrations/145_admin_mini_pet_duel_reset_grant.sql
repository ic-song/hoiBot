START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('ITEM-MINI-PET-DUEL-RESET-TICKET','미니펫대전리셋권🐹','ITEM',TRUE,
  JSON_OBJECT('source','legacy-main.js','legacyExactName','미니펫대전리셋권🐹','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name)
VALUES('inventory.mini_pet_duel_reset.grant','미니펫 대전 리셋권 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.mini_pet_duel_reset.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_MINI_PET_DUEL_RESET_GRANT','admin_mini_pet_duel_reset_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/대전','ADMIN_MINI_PET_DUEL_RESET_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
