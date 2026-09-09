START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('ITEM-LEGENDARY-STONE-DRAW-TICKET','전설의돌 뽑기🩶[2](/전돌뽑기 숫자)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/전돌뽑기','adminGrantCommand','/전돌,'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='ITEM',stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name)
VALUES('inventory.legendary_stone_ticket.grant','전설의돌 뽑기 티켓 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.legendary_stone_ticket.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_LEGENDARY_STONE_TICKET_GRANT','admin_legendary_stone_ticket_grant','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/전돌,','ADMIN_LEGENDARY_STONE_TICKET_GRANT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
