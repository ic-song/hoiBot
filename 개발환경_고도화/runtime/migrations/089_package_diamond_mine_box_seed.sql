START TRANSACTION;

-- 다이아 광산 박스는 독립 명령이 아니라 /패키지사용 전용 고정 보상 catalog seed로 교정합니다.
DELETE FROM command_aliases
WHERE command_code='INVENTORY_DIAMOND_MINE_BOX_OPEN' OR command_text='/다이아박스오픈';

DELETE FROM command_registry
WHERE command_code='INVENTORY_DIAMOND_MINE_BOX_OPEN';

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-DIAMOND-MINE-BOX','STACK','다이아 광산 박스',1,
   JSON_OBJECT('source','legacy-main.js','sourceCommand','/다이아박스오픈','useRoute','/패키지사용',
               'migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-RWD-053','STACK','다이아 상자',1,
   JSON_OBJECT('source','legacy-main.js','rewardFor','/다이아박스오픈'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

UPDATE item_definitions
SET asset_type_code='PACKAGE_ITEM',active=0,version=version+1
WHERE code='ITEM-DIAMOND-MINE-BOX';

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-DIAMOND-MINE-BOX','DRAFT-20260826','다이아 광산 박스',
   '개봉당 다이아 상자 1개 고정 보상',
   'ITEM-DIAMOND-MINE-BOX','/다이아박스오픈',53,1000,0,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE
  catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),
  consume_item_id=VALUES(consume_item_id),source_legacy_command=VALUES(source_legacy_command),
  display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),
  definition_status=VALUES(definition_status),enabled=0,row_version=row_version+1,
  deleted_at=NULL,deleted_by=NULL;

DELETE FROM package_reward_rules WHERE package_id='PKG-DIAMOND-MINE-BOX';
INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
   quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-DIAMOND-MINE-001','PKG-DIAMOND-MINE-BOX',1,'ALL','ALL','ADD','USER','ITEM-RWD-053',
   1,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아박스오픈','legacyRatio','1:1'),NULL,1);

DELETE FROM package_command_aliases WHERE package_id='PKG-DIAMOND-MINE-BOX';

COMMIT;
