START TRANSACTION;

-- 이벤트 박스의 두 레거시 명령은 실행 alias가 아니라 카탈로그 출처 데이터로만 보존합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-DUNGEON-EVENT-BOX','STACK','이벤트박스✡️(/이벤박스오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','event_dungeon_box',
               'sourceCommands',JSON_ARRAY('/이벤박스오픈','/이벤트박스오픈✡️'),
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'PACKAGE_ITEM',stackable,metadata_json,0,1
FROM package_item_definitions
WHERE item_id='ITEM-DUNGEON-EVENT-BOX'
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=0;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-EVENT-DUNGEON-BOX','DRAFT-20260826','이벤트박스✡️',
   '개봉당 샵오픈 100개와 펫던전 입장권 1개 고정 보상',
   'ITEM-DUNGEON-EVENT-BOX','/이벤박스오픈',39,10000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-EVENT-DUNGEON-SHOP','PKG-EVENT-DUNGEON-BOX',1,'ALL','ALL','ADD','USER',
   'ITEM-RWD-001',100,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommands',JSON_ARRAY('/이벤박스오픈','/이벤트박스오픈✡️'),'objectKey','pet_home_shop_open'),NULL,1),
  ('RULE-PKG-EVENT-DUNGEON-TICKET','PKG-EVENT-DUNGEON-BOX',2,'ALL','ALL','ADD','USER',
   'ITEM-RWD-033',1,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommands',JSON_ARRAY('/이벤박스오픈','/이벤트박스오픈✡️'),'objectKey','pet_dungeon_ticket'),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases
WHERE package_id='PKG-EVENT-DUNGEON-BOX';

DELETE FROM command_aliases
WHERE command_text IN ('/이벤박스오픈','/이벤트박스오픈✡️');

COMMIT;
