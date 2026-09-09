START TRANSACTION;

INSERT INTO currency_definitions (code,display_name,scale_digits,active)
VALUES ('diamond','다이아',0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scale_digits=VALUES(scale_digits),active=VALUES(active);

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_DIAMOND_EDIT','admin_diamond_edit','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text,command_code,active) VALUES
('/다이아추가','ADMIN_DIAMOND_EDIT',1),
('/다이아차감','ADMIN_DIAMOND_EDIT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
