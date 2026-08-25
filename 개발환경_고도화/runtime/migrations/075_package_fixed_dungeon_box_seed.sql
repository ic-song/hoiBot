START TRANSACTION;

-- migration 063의 직접 실행 provider를 제거하고 /패키지사용 전용 카탈로그 seed로 교정합니다.
DROP TABLE IF EXISTS fixed_reward_box_rules;

DELETE FROM command_aliases
WHERE command_code IN ('INVENTORY_CHICKEN_DUNGEON_BOX_OPEN','INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN')
   OR command_text IN ('/양계장박스오픈','/샵오픈박스오픈');

DELETE FROM command_registry
WHERE command_code IN ('INVENTORY_CHICKEN_DUNGEON_BOX_OPEN','INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN');

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-DUNGEON-CHICKEN-BOX','STACK','양계장던전박스🐔',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','chicken_dungeon_box','sourceCommand','/양계장박스오픈',
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-DUNGEON-SHOP-OPEN-BOX','STACK','샵오픈던전박스📦',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','shop_open_dungeon_box','sourceCommand','/샵오픈박스오픈',
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0;

UPDATE item_definitions
SET asset_type_code='PACKAGE_ITEM',active=0
WHERE code IN ('ITEM-DUNGEON-CHICKEN-BOX','ITEM-DUNGEON-SHOP-OPEN-BOX');

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-CHICKEN-DUNGEON-BOX','DRAFT-20260826','양계장던전박스🐔',
   '개봉당 치킨패키지박스 10개 고정 보상',
   'ITEM-DUNGEON-CHICKEN-BOX','/양계장박스오픈',37,10000,0,'EXACT_LEGACY_DRAFT',0,1),
  ('PKG-SHOP-OPEN-DUNGEON-BOX','DRAFT-20260826','샵오픈던전박스📦',
   '개봉당 샵오픈 보상 아이템 70개 고정 보상',
   'ITEM-DUNGEON-SHOP-OPEN-BOX','/샵오픈박스오픈',38,10000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-CHICKEN-DUNGEON-001','PKG-CHICKEN-DUNGEON-BOX',1,'ALL','ALL','ADD','USER',
   'ITEM-PACKAGE-CHICKEN-BOX',10,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/양계장박스오픈','objectKey','chicken_package_box'),NULL,1),
  ('RULE-PKG-SHOP-OPEN-DUNGEON-001','PKG-SHOP-OPEN-DUNGEON-BOX',1,'ALL','ALL','ADD','USER',
   'ITEM-RWD-001',70,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/샵오픈박스오픈','objectKey','shop_open_reward'),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases
WHERE package_id IN ('PKG-CHICKEN-DUNGEON-BOX','PKG-SHOP-OPEN-DUNGEON-BOX');

COMMIT;
