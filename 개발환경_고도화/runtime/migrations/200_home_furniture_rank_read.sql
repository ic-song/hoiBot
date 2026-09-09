START TRANSACTION;

ALTER TABLE furniture_inventory_instances
  ADD KEY idx_furniture_inventory_rank_read (status, charm_snapshot DESC, furniture_definition_id, id);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_FURNITURE_RANK_READ','home_furniture_rank_read','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/가구순위','HOME_FURNITURE_RANK_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
