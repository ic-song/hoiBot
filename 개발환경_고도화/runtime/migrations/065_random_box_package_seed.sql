-- /랜덤오픈을 전용 실행 명령이 아닌 공용 패키지 카탈로그 seed로 보존합니다.
START TRANSACTION;

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-PACKAGE-214','STACK','랜덤박스💝',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','random_box','sourceCommand','/랜덤오픈','useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-RWD-TRASH-BOX','STACK','잡템상자☠',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','trash_box'),1,1),
  ('ITEM-RWD-RANDOM-SPIRIT-BOX','STACK','정령상자🥀',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','spirit_box'),1,1),
  ('ITEM-PACKAGE-CHICKEN-BOX','STACK','치킨상자🐔',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','chicken_box'),1,1),
  ('ITEM-RWD-025','STACK','펫먹이🍼',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','pet_food'),1,1),
  ('ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20','STACK','영지절대방어권🛡(20%)',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','territory_defense_ticket'),1,1),
  ('ITEM-RWD-RANDOM-TERRITORY-ATTACK-10','STACK','영지기습공격권🔥(10%)',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','territory_attack_ticket'),1,1)
ON DUPLICATE KEY UPDATE item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,CASE WHEN item_id='ITEM-PACKAGE-214' THEN 'PACKAGE_ITEM' ELSE 'ITEM' END,
       stackable,metadata_json,CASE WHEN item_id='ITEM-PACKAGE-214' THEN FALSE ELSE TRUE END,1
FROM package_item_definitions
WHERE item_id IN ('ITEM-PACKAGE-214','ITEM-RWD-TRASH-BOX','ITEM-RWD-RANDOM-SPIRIT-BOX','ITEM-PACKAGE-CHICKEN-BOX','ITEM-RWD-025','ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20','ITEM-RWD-RANDOM-TERRITORY-ATTACK-10')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=VALUES(active);

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-214','DRAFT-20260825','랜덤박스💝','잡템상자·정령상자·치킨상자·펫먹이·영지방어권·영지기습권 중 1종 균등 보상','ITEM-PACKAGE-214',33,10000,1,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),consume_item_id=VALUES(consume_item_id),display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),definition_status=VALUES(definition_status),enabled=0,row_version=row_version+1;

DELETE FROM package_rewards WHERE package_id='PKG-214';
DELETE FROM package_reward_rules WHERE package_id='PKG-214';

-- 상대 가중치 1:1:1:1:1:1은 소수 오차 없이 정확한 균등 1/6 선택입니다.
INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-214-001','PKG-214',1,'RANDOM_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-TRASH-BOX',1,1,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','trash_box'),NULL,1),
  ('RULE-PKG-214-002','PKG-214',2,'RANDOM_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-RANDOM-SPIRIT-BOX',1,1,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','spirit_box'),NULL,1),
  ('RULE-PKG-214-003','PKG-214',3,'RANDOM_BOX','WEIGHTED_ONE','ADD','USER','ITEM-PACKAGE-CHICKEN-BOX',1,1,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','chicken_box'),NULL,1),
  ('RULE-PKG-214-004','PKG-214',4,'RANDOM_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',1,1,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','pet_food'),NULL,1),
  ('RULE-PKG-214-005','PKG-214',5,'RANDOM_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20',1,1,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','territory_defense_ticket'),NULL,1),
  ('RULE-PKG-214-006','PKG-214',6,'RANDOM_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-RANDOM-TERRITORY-ATTACK-10',1,1,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','territory_attack_ticket'),NULL,1);

INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
VALUES
  ('PKG-214','/랜덤오픈','LEGACY_OPEN','/패키지사용',0,JSON_OBJECT('sourceCommandId','CMD-06-0032','castleBlocked',TRUE,'sharedLegacyRoute','/전체오픈','migrationPolicy','CATALOG_SEED_ONLY'))
ON DUPLICATE KEY UPDATE source_kind=VALUES(source_kind),canonical_route=VALUES(canonical_route),executable=0,metadata_json=VALUES(metadata_json);

DELETE FROM package_command_aliases WHERE package_id='PKG-214' OR command_text='/랜덤오픈';
DELETE FROM command_aliases WHERE command_text='/랜덤오픈';
COMMIT;
