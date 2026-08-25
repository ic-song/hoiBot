START TRANSACTION;

-- 전도르 박스는 독립 실행 명령이 아니라 /패키지사용으로 여는 카탈로그 seed로만 등록합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-DUNGEON-JEONDOR-BOX','STACK','전도르던전박스🗿(/전도르박스오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','jeondor_dungeon_box',
               'sourceCommand','/전도르박스오픈','useRoute','/패키지사용',
               'migrationPolicy','CATALOG_SEED_ONLY'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'PACKAGE_ITEM',stackable,metadata_json,0,1
FROM package_item_definitions
WHERE item_id='ITEM-DUNGEON-JEONDOR-BOX'
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=0;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-JEONDOR-DUNGEON-BOX','DRAFT-20260826','전도르던전박스🗿',
   '개봉당 전설의 돌맹이 1개 고정 보상',
   'ITEM-DUNGEON-JEONDOR-BOX','/전도르박스오픈',40,10000,0,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-JEONDOR-DUNGEON-001','PKG-JEONDOR-DUNGEON-BOX',1,'ALL','ALL','ADD','USER',
   'ITEM-RWD-052',1,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/전도르박스오픈','objectKey','legendary_stone'),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

DELETE FROM package_command_aliases
WHERE package_id='PKG-JEONDOR-DUNGEON-BOX';

DELETE FROM command_aliases
WHERE command_text='/전도르박스오픈';

COMMIT;
