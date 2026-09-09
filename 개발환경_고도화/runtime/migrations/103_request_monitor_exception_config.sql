START TRANSACTION;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG','admin_request_monitor_exception_config','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/요청예외명령추가','ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG',1),
  ('/요청예외명령삭제','ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG',1),
  ('/요청예외방추가','ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG',1),
  ('/요청예외방삭제','ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
