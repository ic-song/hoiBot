START TRANSACTION;

-- 다이아 상자는 독립 명령이 아니라 /패키지사용 전용 다이아 재화 catalog seed로 교정합니다.
DELETE FROM command_aliases
WHERE command_code='INVENTORY_DIAMOND_BOX_OPEN' OR command_text='/다이아상자오픈';

DELETE FROM command_registry
WHERE command_code='INVENTORY_DIAMOND_BOX_OPEN';

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-RWD-053','STACK','다이아 상자',1,
   JSON_OBJECT('source','legacy-main.js','sourceCommand','/다이아상자오픈','useRoute','/패키지사용',
               'migrationPolicy','CATALOG_SEED_ONLY','sharedRewardFor','PKG-DIAMOND-MINE-BOX'),1,1),
  ('diamond','POINT','다이아',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','diamond','currencyCode','diamond'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
SELECT item_id,item_name,item_type,stackable,metadata_json,enabled
FROM package_item_definitions WHERE item_id IN ('ITEM-RWD-053','diamond')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),active=VALUES(active),version=version+1;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-DIAMOND-BOX','DRAFT-20260826','다이아 상자','개봉당 다이아 1개 고정 보상',
   'ITEM-RWD-053','/다이아상자오픈',54,1000,0,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE
  catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),
  consume_item_id=VALUES(consume_item_id),source_legacy_command=VALUES(source_legacy_command),
  display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),
  definition_status=VALUES(definition_status),enabled=0,row_version=row_version+1,
  deleted_at=NULL,deleted_by=NULL;

DELETE FROM package_reward_rules WHERE package_id='PKG-DIAMOND-BOX';
INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
   quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-DIAMOND-001','PKG-DIAMOND-BOX',1,'ALL','ALL','ADD','USER','diamond',
   1,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아상자오픈','currencyCode','diamond','legacyRatio','1:1'),NULL,1);

DELETE FROM package_command_aliases WHERE package_id='PKG-DIAMOND-BOX';

COMMIT;
