START TRANSACTION;

INSERT INTO item_definitions (code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES ('ITEM-DIAMOND-MINE-BOX','다이아 광산 박스','ITEM',TRUE,
  JSON_OBJECT('source','legacy-main.js','legacyExactNameStatus','GATE8_SNAPSHOT_PENDING'),TRUE,1)
ON DUPLICATE KEY UPDATE asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),active=VALUES(active);

UPDATE item_definitions
SET active=TRUE,version=version+1
WHERE code='ITEM-RWD-053' AND active=FALSE;

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('INVENTORY_DIAMOND_MINE_BOX_OPEN','inventory_diamond_mine_box_open','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text,command_code,active)
VALUES ('/다이아박스오픈','INVENTORY_DIAMOND_MINE_BOX_OPEN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
