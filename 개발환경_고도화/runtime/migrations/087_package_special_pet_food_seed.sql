START TRANSACTION;

-- 펫먹이 특식은 독립 실행 명령 없이 /패키지사용으로 여는 가중 카탈로그 seed로 등록합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('pet_food_special','STACK','펫먹이특식🥡(/특식오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','pet_food_special',
               'sourceCommand','/특식오픈','useRoute','/패키지사용',
               'migrationPolicy','CATALOG_SEED_ONLY'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,item_type,stackable,metadata_json,0,1
FROM package_item_definitions
WHERE item_id='pet_food_special'
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=0;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-SPECIAL-PET-FOOD','DRAFT-20260826','펫먹이특식🥡',
   '개봉별 9개 가중 결과; 레거시 펫먹이 이중 합산 mutation 보존',
   'pet_food_special','/특식오픈',52,10000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-SPECIAL-TRASH-BOX','PKG-SPECIAL-PET-FOOD',1,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-TRASH-BOX',1,0.6860000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyUpperPercent',68.6,'objectKey','trash_box'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-BOX','PKG-SPECIAL-PET-FOOD',2,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-PET-FOOD-BOX',1,0.1500000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyUpperPercent',83.6,'objectKey','pet_food_box'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-003','PKG-SPECIAL-PET-FOOD',3,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',6,0.0500000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',3,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-100','PKG-SPECIAL-PET-FOOD',4,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',200,0.0700000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',100,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-150','PKG-SPECIAL-PET-FOOD',5,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',300,0.0300000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',150,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-200','PKG-SPECIAL-PET-FOOD',6,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',400,0.0100000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',200,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-250','PKG-SPECIAL-PET-FOOD',7,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',500,0.0030000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',250,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-500','PKG-SPECIAL-PET-FOOD',8,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',1000,0.0007000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',500,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1),
  ('RULE-PKG-SPECIAL-FOOD-700','PKG-SPECIAL-PET-FOOD',9,'SPECIAL_RESULT','WEIGHTED_ONE','ADD','USER','pet_food',1400,0.0003000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/특식오픈','legacyDisplayedQuantity',700,'legacyDoubleAdd',true,'objectKey','pet_food'),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases WHERE package_id='PKG-SPECIAL-PET-FOOD';
DELETE FROM command_aliases WHERE command_text='/특식오픈';

COMMIT;
