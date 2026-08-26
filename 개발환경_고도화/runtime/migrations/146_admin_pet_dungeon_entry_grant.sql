START TRANSACTION;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES('ITEM-PET-DUNGEON-ENTRY-TICKET','펫던전 입장권🌋','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','펫던전 입장권🌋','gate8Snapshot','pending'),TRUE,1) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;
INSERT INTO admin_permissions(code,display_name) VALUES('inventory.pet_dungeon_entry.grant','펫던전 입장권 지급') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'inventory.pet_dungeon_entry.grant' FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('ADMIN_PET_DUNGEON_ENTRY_GRANT','admin_pet_dungeon_entry_grant','VERIFIED_USER','SHADOW',1,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/던전','ADMIN_PET_DUNGEON_ENTRY_GRANT',1) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
