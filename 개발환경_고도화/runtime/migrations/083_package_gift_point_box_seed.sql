-- 선물상자는 독립 실행 명령이 아니라 /패키지사용으로 여는 포인트 범위 보상 catalog seed로만 등록합니다.

INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES
  ('gift_point_box','STACK','선물상자🎁(/선물오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','gift_point_box','sourceCommand','/선물오픈','useRoute','/패키지사용'),0,1),
  ('point','POINT','포인트',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','point','currencyCode','point'),1,1)
ON DUPLICATE KEY UPDATE item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
SELECT item_id,item_name,item_type,stackable,metadata_json,enabled FROM package_item_definitions
WHERE item_id IN ('gift_point_box','point')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),active=VALUES(active),version=version+1;

INSERT INTO package_catalog(package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
  display_order,max_open_count,block_castle,definition_status,enabled,row_version) VALUES
  ('PKG-GIFT-POINT-BOX','DRAFT-20260826','선물상자','개봉마다 포인트 50만~300만을 50만 단위로 균등 지급',
   'gift_point_box','/선물오픈',48,10000,1,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),
  consume_item_id=VALUES(consume_item_id),source_legacy_command=VALUES(source_legacy_command),display_order=VALUES(display_order),
  max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),definition_status=VALUES(definition_status),
  enabled=VALUES(enabled),row_version=row_version+1,deleted_at=NULL,deleted_by=NULL;

DELETE FROM package_reward_rules WHERE package_id='PKG-GIFT-POINT-BOX';
INSERT INTO package_reward_rules(rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
  quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled) VALUES
  ('RULE-PKG-GIFT-POINT-001','PKG-GIFT-POINT-BOX',1,'GIFT_POINT','UNIFORM_RANGE','ADD','USER','point',
   1,NULL,500000,3000000,500000,NULL,
   JSON_OBJECT('sourceCommand','/선물오픈','objectKey','point','currencyCode','point','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1);

DELETE FROM package_command_aliases WHERE package_id='PKG-GIFT-POINT-BOX';
DELETE FROM command_aliases WHERE command_text='/선물오픈';
