START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('legacy-castle-battle-reset-ticket','캐슬대전리셋권🐶','ITEM',TRUE,
  JSON_OBJECT('source','legacy-main.js','legacyExactName','캐슬대전리셋권🐶','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name)
VALUES('inventory.castle_battle_reset.grant','캐슬 대전 리셋권 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.castle_battle_reset.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_CASTLE_BATTLE_RESET_GRANT','admin_castle_battle_reset_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/캐대전','ADMIN_CASTLE_BATTLE_RESET_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
