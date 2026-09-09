START TRANSACTION;

-- 럭키박스는 독립 실행 명령 없이 /패키지사용으로 여는 6단계 가중 카탈로그 seed입니다.
DELETE FROM command_aliases
WHERE command_code='INVENTORY_LUCKY_REWARD_OPEN' OR command_text='/럭키오픈';
DELETE FROM command_registry WHERE command_code='INVENTORY_LUCKY_REWARD_OPEN';

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('reward_lucky_box','STACK','럭키박스🍀(/럭키오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','reward_lucky_box','sourceCommand','/럭키오픈',
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),1,1),
  ('weekly_box','STACK','주간상자🦋(/주간오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','weekly_box','rewardFor','/럭키오픈'),1,1),
  ('mini_pet_draw','STACK','미니펫뽑기🐹(/미니펫오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','mini_pet_draw','rewardFor','/럭키오픈'),1,1),
  ('pet_enhance_stone','STACK','펫 강화석⭐',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','pet_enhance_stone','rewardFor','/럭키오픈'),1,1),
  ('ITEM-RWD-022','STACK','티어 승급티켓🎟',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemId','ITEM-RWD-022','rewardFor','/럭키오픈'),1,1),
  ('point','POINT','포인트',0,
   JSON_OBJECT('source','legacy-main.js','objectKey','point','currencyCode','point','rewardFor','/럭키오픈'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=1;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,item_type,stackable,metadata_json,1,1
FROM package_item_definitions
WHERE item_id IN ('reward_lucky_box','weekly_box','mini_pet_draw','pet_enhance_stone','ITEM-RWD-022','point')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=1;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-LUCKY-REWARD-BOX','DRAFT-20260826','럭키 보상 상자',
   '개봉별 주간상자·미니펫뽑기·펫 강화석·티어 승급티켓·포인트 중 가중 1종 지급',
   'reward_lucky_box','/럭키오픈',57,1000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-LUCKY-REWARD-WEEKLY','PKG-LUCKY-REWARD-BOX',1,'LUCKY_REWARD','WEIGHTED_ONE','ADD','USER','weekly_box',1,0.0001000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/럭키오픈','legacyUpperPercent',0.01),NULL,1),
  ('RULE-PKG-LUCKY-REWARD-MINIPET','PKG-LUCKY-REWARD-BOX',2,'LUCKY_REWARD','WEIGHTED_ONE','ADD','USER','mini_pet_draw',3,0.0050000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/럭키오픈','legacyUpperPercent',0.51),NULL,1),
  ('RULE-PKG-LUCKY-REWARD-PET-STONE','PKG-LUCKY-REWARD-BOX',3,'LUCKY_REWARD','WEIGHTED_ONE','ADD','USER','pet_enhance_stone',20,0.0100000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/럭키오픈','legacyUpperPercent',1.51),NULL,1),
  ('RULE-PKG-LUCKY-REWARD-TIER-TICKET','PKG-LUCKY-REWARD-BOX',4,'LUCKY_REWARD','WEIGHTED_ONE','ADD','USER','ITEM-RWD-022',4,0.0300000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/럭키오픈','legacyUpperPercent',4.51),NULL,1),
  ('RULE-PKG-LUCKY-REWARD-POINT-25M','PKG-LUCKY-REWARD-BOX',5,'LUCKY_REWARD','WEIGHTED_ONE','ADD','USER','point',25000000,0.1000000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/럭키오픈','legacyUpperPercent',14.51,'currencyCode','point'),NULL,1),
  ('RULE-PKG-LUCKY-REWARD-POINT-15M','PKG-LUCKY-REWARD-BOX',6,'LUCKY_REWARD','WEIGHTED_ONE','ADD','USER','point',15000000,0.8549000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/럭키오픈','legacyUpperPercent',100.0,'currencyCode','point'),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  metadata_override_json=VALUES(metadata_override_json),selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases WHERE package_id='PKG-LUCKY-REWARD-BOX';

COMMIT;
