START TRANSACTION;
CREATE INDEX idx_furniture_stats_read ON furniture_inventory_instances(status,grade_display_name,id);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('HOME_FURNITURE_STATS_READ','home_furniture_stats_read','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/가구통계','HOME_FURNITURE_STATS_READ',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
