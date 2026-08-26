START TRANSACTION;

ALTER TABLE player_pets
  ADD KEY idx_player_pets_upgrade_rank
    (enhancement_level DESC, enhancement_updated_at, player_id);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_UPGRADE_RANK_READ','pet_upgrade_rank_read','TRUSTED_DISPLAY_NAME','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫강순위','PET_UPGRADE_RANK_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
