START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES('matzang.session.manage','맞짱 세션 시작·종료') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'matzang.session.manage' FROM admin_roles WHERE code IN ('super_admin','manager') ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('MATZZANG_SESSION_START','matzang_session_start','VERIFIED_USER','SHADOW',1,1),('MATZZANG_SESSION_END','matzang_session_end','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/맞짱시작','MATZZANG_SESSION_START',1),('/맞짱종료','MATZZANG_SESSION_END',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
