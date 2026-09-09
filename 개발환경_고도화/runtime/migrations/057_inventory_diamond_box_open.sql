START TRANSACTION;

INSERT INTO currency_definitions (code,display_name,scale_digits,active)
VALUES ('diamond','다이아',0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scale_digits=VALUES(scale_digits),active=VALUES(active);

UPDATE item_definitions
SET active=TRUE,version=version+1
WHERE code='ITEM-RWD-053' AND active=FALSE;

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('INVENTORY_DIAMOND_BOX_OPEN','inventory_diamond_box_open','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text,command_code,active)
VALUES ('/다이아상자오픈','INVENTORY_DIAMOND_BOX_OPEN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
