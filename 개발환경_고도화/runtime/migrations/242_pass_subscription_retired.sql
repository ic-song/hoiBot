START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('PASS_SUBSCRIPTION_RETIRED','pass_subscription_retired','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/공헌패스구독','PASS_SUBSCRIPTION_RETIRED',TRUE),('/다이아패스구독','PASS_SUBSCRIPTION_RETIRED',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
