START TRANSACTION;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('PET_EXPLORE_MAP_READ','pet_explore_map_read','VERIFIED_USER','SHADOW',TRUE,1),
('PET_EXPLORE_USER_CHECK_READ','pet_explore_user_check_read','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/지도','PET_EXPLORE_MAP_READ',TRUE),
('/탐험유저확인','PET_EXPLORE_USER_CHECK_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
