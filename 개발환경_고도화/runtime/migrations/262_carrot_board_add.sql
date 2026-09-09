INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MARKET_CARROT_BOARD_ADD','carrot_board_add','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/당근등록','MARKET_CARROT_BOARD_ADD',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
