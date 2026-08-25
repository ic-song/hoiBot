-- /다이아오픈을 전용 실행 명령이 아닌 공용 패키지 카탈로그 seed로 보존합니다.
START TRANSACTION;

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-PACKAGE-213','STACK','💎다이아 상자(/다이아오픈)',1,
   JSON_OBJECT('source','legacy-main.js','sourceCommand','/다이아오픈',
     'useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0,row_version=row_version+1;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'PACKAGE_ITEM',1,metadata_json,0,1
FROM package_item_definitions
WHERE item_id='ITEM-PACKAGE-213'
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=FALSE;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-213','DRAFT-20260825','💎다이아 상자',
   '캐슬코인 200·펫강화확률UP(30%) 6·펫 강화석 2200 확정 보상',
   'ITEM-PACKAGE-213',32,1,1,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE
  catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),
  description=VALUES(description),consume_item_id=VALUES(consume_item_id),
  display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),
  block_castle=VALUES(block_castle),definition_status=VALUES(definition_status),
  enabled=0,row_version=row_version+1;

DELETE FROM package_rewards WHERE package_id='PKG-213';

INSERT INTO package_rewards
  (package_id,reward_order,item_id,quantity,probability,target_selector,metadata_override_json)
VALUES
  ('PKG-213',1,'ITEM-RWD-042',200,1,'ADD',
   JSON_OBJECT('effect','ADD','sourceCommand','/다이아오픈','migrationPolicy','CATALOG_SEED_ONLY')),
  ('PKG-213',2,'ITEM-RWD-065',6,1,'ADD',
   JSON_OBJECT('effect','ADD','sourceCommand','/다이아오픈','migrationPolicy','CATALOG_SEED_ONLY')),
  ('PKG-213',3,'ITEM-RWD-026',2200,1,'ADD',
   JSON_OBJECT('effect','ADD','sourceCommand','/다이아오픈','migrationPolicy','CATALOG_SEED_ONLY'));

DELETE FROM package_reward_rules WHERE package_id='PKG-213';

INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,
   item_id,quantity,weight,range_min,range_max,range_step,target_selector,
   metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-213-001','PKG-213',1,'ALL','ALL','ADD','USER',
   'ITEM-RWD-042',200,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아오픈','migrationPolicy','CATALOG_SEED_ONLY'),NULL,1),
  ('RULE-PKG-213-002','PKG-213',2,'ALL','ALL','ADD','USER',
   'ITEM-RWD-065',6,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아오픈','migrationPolicy','CATALOG_SEED_ONLY'),NULL,1),
  ('RULE-PKG-213-003','PKG-213',3,'ALL','ALL','ADD','USER',
   'ITEM-RWD-026',2200,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아오픈','migrationPolicy','CATALOG_SEED_ONLY'),NULL,1);

INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
VALUES
  ('PKG-213','/다이아오픈','LEGACY_OPEN','/패키지사용',0,
   JSON_OBJECT('sourceCommandId','CMD-06-0023','castleBlocked',TRUE,
     'migrationPolicy','CATALOG_SEED_ONLY'))
ON DUPLICATE KEY UPDATE
  source_kind=VALUES(source_kind),canonical_route=VALUES(canonical_route),
  executable=0,metadata_json=VALUES(metadata_json);

-- 전용 명령은 신규 dispatch에 등록하지 않고 /패키지사용으로만 실행합니다.
DELETE FROM package_command_aliases
WHERE package_id='PKG-213' OR command_text='/다이아오픈';

DELETE FROM command_aliases
WHERE command_text='/다이아오픈';

COMMIT;
