START TRANSACTION;

INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value)
SELECT active_configuration_set_id,'notice.advertisement','string',''
FROM operation_notice_heads
WHERE set_code='operation_notices'
ON DUPLICATE KEY UPDATE value_type='string',string_value=COALESCE(string_value,'');

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('OPERATION_ADVERTISEMENT_MUTATE','operation_notice_mutate','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/광고','OPERATION_ADVERTISEMENT_MUTATE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
