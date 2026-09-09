START TRANSACTION;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
VALUES('pet_skill_extinction_ticket','펫스킬소멸권🧙‍♂️(/펫스킬소멸 번호)','ITEM',TRUE,JSON_OBJECT('objectType','pet_skill_extinction_ticket'),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),metadata_json=VALUES(metadata_json),active=TRUE;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_EXTINCTION','pet_skill_extinction','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펫스킬소멸 [번호]','PET_SKILL_EXTINCTION',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
