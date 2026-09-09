START TRANSACTION;

-- 캐슬 유닛 상자는 독립 실행 명령 없이 /패키지사용으로 여는 가중 카탈로그 seed로 등록합니다.
DELETE FROM command_aliases
WHERE command_code='INVENTORY_CASTLE_UNIT_BOX_OPEN' OR command_text='/캐슬오픈';
DELETE FROM command_registry WHERE command_code='INVENTORY_CASTLE_UNIT_BOX_OPEN';

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-PACKAGE-CASTLE-UNIT-BOX','STACK','캐슬 유닛 상자',1,
   JSON_OBJECT('source','legacy-main.js','sourceCommand','/캐슬오픈','useRoute','/패키지사용',
               'migrationPolicy','CATALOG_SEED_ONLY','legacyConsumerItemId','ITEM-RWD-PET-FOOD-BOX',
               'consumerCollisionPackageId','PKG-215','requiresGate8DataSplit',true),1,1),
  ('ITEM-RWD-CASTLE-ADVANCED','STACK','캐슬고급유닛🧙🏼‍♂(+50💕)',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','castle_advanced_unit','rewardFor','/캐슬오픈'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=1;

UPDATE package_item_definitions SET enabled=1
WHERE item_id IN (
  'ITEM-PACKAGE-CASTLE-UNIT-BOX','ITEM-RWD-CASTLE-MYTH','ITEM-RWD-CASTLE-LEGEND',
  'ITEM-RWD-CASTLE-UNIQUE','ITEM-RWD-CASTLE-RARE','ITEM-RWD-CASTLE-ADVANCED'
);

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,item_type,stackable,metadata_json,1,1
FROM package_item_definitions
WHERE item_id IN (
  'ITEM-PACKAGE-CASTLE-UNIT-BOX','ITEM-RWD-CASTLE-MYTH','ITEM-RWD-CASTLE-LEGEND',
  'ITEM-RWD-CASTLE-UNIQUE','ITEM-RWD-CASTLE-RARE','ITEM-RWD-CASTLE-ADVANCED'
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=1;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-CASTLE-UNIT-BOX','DRAFT-20260826','캐슬 유닛 상자',
   '개봉별 캐슬 신화·전설·유니크·레어·고급 유닛 가중 1개',
   'ITEM-PACKAGE-CASTLE-UNIT-BOX','/캐슬오픈',55,1000,1,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-CASTLE-UNIT-MYTH','PKG-CASTLE-UNIT-BOX',1,'CASTLE_UNIT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-CASTLE-MYTH',1,0.0005000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/캐슬오픈','legacyUpperPercent',0.05),NULL,1),
  ('RULE-PKG-CASTLE-UNIT-LEGEND','PKG-CASTLE-UNIT-BOX',2,'CASTLE_UNIT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-CASTLE-LEGEND',1,0.0030000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/캐슬오픈','legacyUpperPercent',0.35),NULL,1),
  ('RULE-PKG-CASTLE-UNIT-UNIQUE','PKG-CASTLE-UNIT-BOX',3,'CASTLE_UNIT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-CASTLE-UNIQUE',1,0.0150000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/캐슬오픈','legacyUpperPercent',1.85),NULL,1),
  ('RULE-PKG-CASTLE-UNIT-RARE','PKG-CASTLE-UNIT-BOX',4,'CASTLE_UNIT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-CASTLE-RARE',1,0.1000000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/캐슬오픈','legacyUpperPercent',11.85),NULL,1),
  ('RULE-PKG-CASTLE-UNIT-ADVANCED','PKG-CASTLE-UNIT-BOX',5,'CASTLE_UNIT','WEIGHTED_ONE','ADD','USER','ITEM-RWD-CASTLE-ADVANCED',1,0.8815000000,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/캐슬오픈','legacyUpperPercent',100.0),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  metadata_override_json=VALUES(metadata_override_json),selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases WHERE package_id='PKG-CASTLE-UNIT-BOX';

COMMIT;
