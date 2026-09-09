START TRANSACTION;
INSERT INTO support_pass_definitions(pass_code,display_name,active) VALUES('oneday','원데이패스',TRUE) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('ONE_DAY_PASS_REGISTRY','one_day_pass_registry','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/원데이패스추가','ONE_DAY_PASS_REGISTRY',TRUE),('/원데이패스삭제','ONE_DAY_PASS_REGISTRY',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
