START TRANSACTION;

-- 시련의상자는 독립 실행 명령이 아니라 /패키지사용으로 여는 카탈로그 seed로만 등록합니다.
DELETE FROM command_aliases WHERE command_text='/시련오픈';

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-PACKAGE-TRIAL-BOX','STACK','시련의상자😈(/시련오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','trial_box','sourceCommand','/시련오픈',
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-RWD-TRIAL-TOWER-GUIDE','STACK','시탑 공략서📜',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','trial_tower_guide'),0,1),
  ('ITEM-RWD-HAPPY-DICE','STACK','주사위🎲(/해피)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','happy_dice'),0,1),
  ('ITEM-RWD-TRIAL-TOWER-RESET','STACK','시련의탑리셋권😈',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','trial_tower_reset_ticket'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'PACKAGE_ITEM',stackable,metadata_json,0,1
FROM package_item_definitions
WHERE item_id IN ('ITEM-PACKAGE-TRIAL-BOX','ITEM-RWD-TRIAL-TOWER-GUIDE',
                  'ITEM-RWD-HAPPY-DICE','ITEM-RWD-TRIAL-TOWER-RESET')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=0;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-TRIAL-BOX','DRAFT-20260827','시련의상자😈',
   '개봉당 시탑 공략서 20개·시탑 부스터 15개·주사위 10개·시련의탑리셋권 3개 고정 보상',
   'ITEM-PACKAGE-TRIAL-BOX','/시련오픈',39,10000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-TRIAL-BOX-001','PKG-TRIAL-BOX',1,'ALL','ALL','ADD','USER',
   'ITEM-RWD-TRIAL-TOWER-GUIDE',20,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/시련오픈','objectKey','trial_tower_guide'),NULL,1),
  ('RULE-PKG-TRIAL-BOX-002','PKG-TRIAL-BOX',2,'ALL','ALL','ADD','USER',
   'ITEM-RWD-038',15,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/시련오픈','objectKey','trial_tower_booster'),NULL,1),
  ('RULE-PKG-TRIAL-BOX-003','PKG-TRIAL-BOX',3,'ALL','ALL','ADD','USER',
   'ITEM-RWD-HAPPY-DICE',10,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/시련오픈','objectKey','happy_dice'),NULL,1),
  ('RULE-PKG-TRIAL-BOX-004','PKG-TRIAL-BOX',4,'ALL','ALL','ADD','USER',
   'ITEM-RWD-TRIAL-TOWER-RESET',3,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/시련오픈','objectKey','trial_tower_reset_ticket'),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

-- 레거시 명령 문자열은 실행 alias로 등록하지 않습니다.
DELETE FROM package_command_aliases WHERE package_id='PKG-TRIAL-BOX';

COMMIT;
