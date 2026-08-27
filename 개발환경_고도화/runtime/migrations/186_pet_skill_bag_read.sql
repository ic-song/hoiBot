START TRANSACTION;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_BAG_READ','pet_skill_bag_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫스킬가방','PET_SKILL_BAG_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
