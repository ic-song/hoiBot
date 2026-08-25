START TRANSACTION;

-- 1억 포인트 상자는 독립 실행 명령 없이 /패키지사용으로 여는 고정 POINT 카탈로그 seed입니다.
DELETE FROM command_aliases
WHERE command_code='INVENTORY_POINT_BOX_OPEN' OR command_text='/포인트상자오픈';
DELETE FROM command_registry WHERE command_code='INVENTORY_POINT_BOX_OPEN';

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('point_box_100m','STACK','1억포인트상자🪙(/포인트상자오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','point_box_100m','sourceCommand','/포인트상자오픈',
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),1,1),
  ('point','POINT','포인트',0,
   JSON_OBJECT('source','legacy-main.js','objectKey','point','currencyCode','point','rewardFor','/포인트상자오픈'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=1;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,item_type,stackable,metadata_json,1,1
FROM package_item_definitions WHERE item_id IN ('point_box_100m','point')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=1;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-POINT-BOX-100M','DRAFT-20260826','1억 포인트 상자','개봉당 포인트 100,000,000 고정 지급',
   'point_box_100m','/포인트상자오픈',56,1000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-POINT-BOX-100M-001','PKG-POINT-BOX-100M',1,'POINT_100M','ALL','ADD','USER',
   'point',100000000,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/포인트상자오픈','currencyCode','point','rewardPerOpen',100000000),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),metadata_override_json=VALUES(metadata_override_json),enabled=1;

DELETE FROM package_command_aliases WHERE package_id='PKG-POINT-BOX-100M';

COMMIT;
