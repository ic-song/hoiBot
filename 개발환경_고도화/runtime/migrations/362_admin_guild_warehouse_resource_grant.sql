START TRANSACTION;

INSERT INTO currency_definitions(code,display_name,scale_digits,active) VALUES
('diamond','다이아',0,TRUE),('guild_fund','길드자금',0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scale_digits=0,active=TRUE;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('guild_pendant_stock','펜던트','STACK',TRUE,JSON_OBJECT('legacyField','guild.warehouse.pendant','gate8Snapshot','pending'),TRUE,1),
('pet_enhance_stone','펫 강화석','STACK',TRUE,JSON_OBJECT('legacyField','guild.warehouse.pet','gate8Snapshot','pending'),TRUE,1),
('mini_pet_enhance_stone','미니펫 강화석','STACK',TRUE,JSON_OBJECT('legacyField','guild.warehouse.miniPet','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name) VALUES('guild.warehouse.resource.grant','길드창고 자원 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'guild.warehouse.resource.grant' FROM admin_roles WHERE code IN ('administrator','manager','super_admin')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT','admin_guild_warehouse_resource_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/길드다이아창고','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),('/길드다이아창고 [길드명] [수량]','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),
('/길드자금','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),('/길드자금 [길드명] [수량]','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),
('/길드펜던트창고','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),('/길드펜던트창고 [길드명] [수량]','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),
('/길드펫강화석창고','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),('/길드펫강화석창고 [길드명] [수량]','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),
('/길드미니펫강화석창고','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1),('/길드미니펫강화석창고 [길드명] [수량]','ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
