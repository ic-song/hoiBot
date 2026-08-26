START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('MATZZANG_FIELD_LIST','matzang_field_list','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/맞짱필드목록','MATZZANG_FIELD_LIST',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
