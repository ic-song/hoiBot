START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('legacy-title-gift-ticket','타이틀선물권💝(/타이틀선물 닉네임 내용)','item',TRUE,JSON_OBJECT('legacyName','타이틀선물권💝(/타이틀선물 닉네임 내용)'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='item',stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PLAYER_TITLE_GIFT','player_title_gift','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/타이틀선물','PLAYER_TITLE_GIFT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
