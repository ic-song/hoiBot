START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('pet_skill_book_fragment','펫스킬북 조각📙','STACK',TRUE,
       JSON_OBJECT('source','legacy-main.js','objectKey','guild.warehouse.petSkillBook','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name)
VALUES('guild.warehouse.pet_skill_book_fragment.grant','길드창고 펫스킬북 조각 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'guild.warehouse.pet_skill_book_fragment.grant' FROM admin_roles WHERE code IN ('manager','super_admin')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_GUILD_PET_SKILL_STOCK_GRANT','guild_pet_skill_stock_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/길드펫스킬창고','ADMIN_GUILD_PET_SKILL_STOCK_GRANT',1),
('/길드펫스킬창고 [길드명] [수량]','ADMIN_GUILD_PET_SKILL_STOCK_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
