START TRANSACTION;

-- legacy package_5 consume identity를 current package catalog의 stable key로 등록합니다.
INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES
  ('package_5','자유시장회원권🏪+주간🦋 20개','PACKAGE_ITEM',TRUE,
   JSON_OBJECT('sourceContract','v2.400','legacySource','data/packageInfo.json','legacyPackageId','package_5',
               'canonicalState','ACTIVE','useRoute','/패키지사용'),TRUE,1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,
  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)),active=TRUE;

INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('package_5','STACK','자유시장회원권🏪+주간🦋 20개',TRUE,
   JSON_OBJECT('sourceContract','v2.400','legacySource','data/packageInfo.json','legacyPackageId','package_5',
               'canonicalItemCode','package_5','useRoute','/패키지사용'),TRUE,1)
ON DUPLICATE KEY UPDATE
  item_type='STACK',item_name=VALUES(item_name),stackable=TRUE,
  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)),enabled=TRUE;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('package_5','LEGACY-PACKAGEINFO-v1','자유시장회원권🏪+주간🦋 20개',
   '거래록갯수를 늘려줍니다. \n자유시장회원권🏪 1개 주간상자 20개',
   'package_5','data/packageInfo.json#package_5',5,100,0,'READY',TRUE,1)
ON DUPLICATE KEY UPDATE
  catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),
  consume_item_id=VALUES(consume_item_id),source_legacy_command=VALUES(source_legacy_command),
  display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),
  definition_status='READY',enabled=TRUE;

INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,
   item_id,quantity,weight,range_min,range_max,range_step,target_selector,
   metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PACKAGE-5-FREE-MARKET-MEMBERSHIP-001','package_5',1,'ALL','ALL','ADD','USER',
   'free_market_membership',1,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceContract','v2.400','legacySource','data/packageInfo.json','legacyPackageId','package_5',
               'legacyRewardIndex',0,'canonicalItemCode','free_market_membership'),NULL,TRUE)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=TRUE;

-- packageInfo 기반 패키지는 기존 /패키지사용 경로만 사용하며 새 명령 alias를 만들지 않습니다.
DELETE FROM package_command_aliases WHERE package_id='package_5';

COMMIT;
