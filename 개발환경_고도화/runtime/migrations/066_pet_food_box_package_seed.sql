-- /상자오픈을 전용 실행 명령이 아닌 공용 패키지 카탈로그 seed로 보존합니다.
START TRANSACTION;

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-RWD-PET-FOOD-BOX','STACK','펫먹이상자📦(/상자오픈)',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','pet_food_box','sourceCommand','/상자오픈','useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),1,1),
  ('ITEM-RWD-025','STACK','펫먹이🍼',1,JSON_OBJECT('source','legacy-main.js','legacyItemCode','pet_food'),1,1)
ON DUPLICATE KEY UPDATE item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'ITEM',stackable,metadata_json,TRUE,1
FROM package_item_definitions
WHERE item_id IN ('ITEM-RWD-PET-FOOD-BOX','ITEM-RWD-025')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=TRUE;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-215','DRAFT-20260825','펫먹이상자📦','펫먹이 50·100·250·500개를 98.15%·1.5%·0.3%·0.05%로 지급','ITEM-RWD-PET-FOOD-BOX',34,10000,0,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),consume_item_id=VALUES(consume_item_id),display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),definition_status=VALUES(definition_status),enabled=0,row_version=row_version+1;

DELETE FROM package_rewards WHERE package_id='PKG-215';
DELETE FROM package_reward_rules WHERE package_id='PKG-215';

-- 9815:150:30:5 상대 가중치는 legacy 확률을 소수 오차 없이 정확히 보존합니다.
INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-215-001','PKG-215',1,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',50,9815,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/상자오픈','legacyProbability',0.9815),NULL,1),
  ('RULE-PKG-215-002','PKG-215',2,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',100,150,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/상자오픈','legacyProbability',0.015),NULL,1),
  ('RULE-PKG-215-003','PKG-215',3,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',250,30,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/상자오픈','legacyProbability',0.003),NULL,1),
  ('RULE-PKG-215-004','PKG-215',4,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',500,5,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/상자오픈','legacyProbability',0.0005),NULL,1);

INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
VALUES
  ('PKG-215','/상자오픈','LEGACY_OPEN','/패키지사용',0,
   JSON_OBJECT('sourceCommandId','CMD-06-0045','sharedLegacyRoute','/전체오픈','conflictingLegacyCommand','/캐슬오픈','conflictPolicy','EXCLUDED_FROM_PACKAGE_ALIAS','migrationPolicy','CATALOG_SEED_ONLY'))
ON DUPLICATE KEY UPDATE source_kind=VALUES(source_kind),canonical_route=VALUES(canonical_route),executable=0,metadata_json=VALUES(metadata_json);

DELETE FROM package_command_aliases WHERE package_id='PKG-215' OR command_text IN ('/상자오픈','/캐슬오픈');
DELETE FROM command_aliases WHERE command_text='/상자오픈';
COMMIT;
