START TRANSACTION;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active) VALUES
('pet_skill_book_fragment','펫스킬북 조각📙','ITEM',TRUE,JSON_OBJECT('objectType','pet_skill_book_fragment'),TRUE),
('pet_skill_book','펫스킬북📙(/펫스킬오픈)','ITEM',TRUE,JSON_OBJECT('objectType','pet_skill_book'),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),metadata_json=VALUES(metadata_json),active=TRUE;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_BOOK_COMBINE','pet_skill_book_combine','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/펫스킬북조합','PET_SKILL_BOOK_COMBINE',TRUE),('/펫스킬북조합 [숫자]','PET_SKILL_BOOK_COMBINE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
