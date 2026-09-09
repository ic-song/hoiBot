START TRANSACTION;

-- 정령상자는 독립 실행 명령 없이 /패키지사용으로 여는 5~10 균등 범위 카탈로그 seed입니다.
DELETE FROM command_aliases
WHERE command_text='/정령오픈'
   OR command_code IN ('INVENTORY_FIXED_RANGE_BOX_OPEN','INVENTORY_SPIRIT_BOX_OPEN');
DELETE FROM command_registry
WHERE command_code IN ('INVENTORY_FIXED_RANGE_BOX_OPEN','INVENTORY_SPIRIT_BOX_OPEN');

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('spirit_box','STACK','정령상자🥀(/정령오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','spirit_box','sourceCommand','/정령오픈',
               'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY',
               'supersedesItemId','ITEM-RWD-RANDOM-SPIRIT-BOX'),1,1),
  ('spirit_fragment','STACK','정령조각🥀',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','spirit_fragment','rewardFor','/정령오픈'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=1;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,item_type,stackable,metadata_json,1,1
FROM package_item_definitions
WHERE item_id IN ('spirit_box','spirit_fragment')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=1;

-- 랜덤박스가 지급하는 정령상자도 동일한 안정 키를 사용하도록 producer/consumer를 연결합니다.
UPDATE package_reward_rules
SET item_id='spirit_box',
    metadata_override_json=JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','spirit_box',
                                      'supersedesItemId','ITEM-RWD-RANDOM-SPIRIT-BOX')
WHERE rule_id='RULE-PKG-214-002' AND package_id='PKG-214';

UPDATE package_item_definitions SET enabled=0
WHERE item_id='ITEM-RWD-RANDOM-SPIRIT-BOX';
UPDATE item_definitions SET active=0
WHERE code='ITEM-RWD-RANDOM-SPIRIT-BOX';

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-SPIRIT-BOX','DRAFT-20260826','정령상자','개봉별 정령조각 5~10개 균등 지급',
   'spirit_box','/정령오픈',58,1000,1,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-SPIRIT-BOX-001','PKG-SPIRIT-BOX',1,'SPIRIT_FRAGMENT','UNIFORM_RANGE','ADD','USER',
   'spirit_fragment',1,NULL,5,10,1,NULL,
   JSON_OBJECT('sourceCommand','/정령오픈','objectKey','spirit_fragment',
               'legacyRangeMin',5,'legacyRangeMax',10),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  metadata_override_json=VALUES(metadata_override_json),selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases WHERE package_id='PKG-SPIRIT-BOX';

COMMIT;
