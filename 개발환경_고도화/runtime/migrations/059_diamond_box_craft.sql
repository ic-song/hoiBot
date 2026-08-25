START TRANSACTION;

UPDATE item_definitions SET active=TRUE,version=version+1
WHERE code IN ('ITEM-RWD-052','ITEM-RWD-053') AND active=FALSE;

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('DIAMOND_BOX_CRAFT','diamond_box_craft','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text,command_code,active)
VALUES ('/다이아조합','DIAMOND_BOX_CRAFT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
