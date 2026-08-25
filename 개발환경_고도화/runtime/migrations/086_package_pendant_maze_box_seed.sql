START TRANSACTION;

-- 펜던트 미궁 박스는 실행 명령 없이 /패키지사용으로 여는 카탈로그 seed로 등록합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-DUNGEON-PENDANT-MAZE-BOX','STACK','펜던트미궁박스💎(/펜던트미궁박스오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','pendant_maze_box','sourceCommand','/펜던트미궁박스오픈','useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-PENDANT-ENHANCE-STONE','STACK','펜던트 강화석📿',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','pendant_enhance_stone'),1,1),
  ('ITEM-PENDANT-RESTORE-STONE','STACK','펜던트 복구석💎',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','pendant_restore_stone'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled);

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'PACKAGE_ITEM',stackable,metadata_json,enabled,1
FROM package_item_definitions
WHERE item_id IN ('ITEM-DUNGEON-PENDANT-MAZE-BOX','ITEM-PENDANT-ENHANCE-STONE','ITEM-PENDANT-RESTORE-STONE')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=VALUES(active);

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-PENDANT-MAZE-BOX','DRAFT-20260826','펜던트미궁박스💎',
   '개봉당 펜던트 강화석 3~4개와 독립 1% 펜던트 복구석 보상',
   'ITEM-DUNGEON-PENDANT-MAZE-BOX','/펜던트미궁박스오픈',51,10000,0,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE
  catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),
  description=VALUES(description),consume_item_id=VALUES(consume_item_id),
  source_legacy_command=VALUES(source_legacy_command),display_order=VALUES(display_order),
  max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),
  definition_status=VALUES(definition_status),enabled=0;

INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,
   item_id,quantity,weight,range_min,range_max,range_step,target_selector,
   metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-PENDANT-ENHANCE','PKG-PENDANT-MAZE-BOX',1,'ENHANCE','UNIFORM_RANGE','ADD','USER',
   'ITEM-PENDANT-ENHANCE-STONE',1,NULL,3,4,1,NULL,
   JSON_OBJECT('sourceCommand','/펜던트미궁박스오픈','rngOrder',1,'objectKey','pendant_enhance_stone'),NULL,1),
  ('RULE-PKG-PENDANT-RESTORE','PKG-PENDANT-MAZE-BOX',2,'RESTORE_BONUS','WEIGHTED_ONE','ADD','USER',
   'ITEM-PENDANT-RESTORE-STONE',1,0.0100000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/펜던트미궁박스오픈','rngOrder',2,'objectKey','pendant_restore_stone'),NULL,1),
  ('RULE-PKG-PENDANT-NO-RESTORE','PKG-PENDANT-MAZE-BOX',3,'RESTORE_BONUS','WEIGHTED_ONE','NONE','USER',
   NULL,0,0.9900000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/펜던트미궁박스오픈','rngOrder',2,'noReward',true),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases WHERE package_id='PKG-PENDANT-MAZE-BOX';
DELETE FROM command_aliases WHERE command_text='/펜던트미궁박스오픈';

COMMIT;
