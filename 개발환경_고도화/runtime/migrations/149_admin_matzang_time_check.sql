START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES('diagnostic.matzang_charm.read','맞짱 종합매력 성능 진단') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'diagnostic.matzang_charm.read' FROM admin_roles WHERE code IN ('super_admin','manager') ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('ADMIN_MATZZANG_TIME_CHECK','admin_matzang_time_check','VERIFIED_USER','SHADOW',1,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/맞짱시간체크','ADMIN_MATZZANG_TIME_CHECK',1) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
