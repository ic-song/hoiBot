-- 성 티어 상자 3종은 독립 실행 명령이 아니라 /패키지사용으로 여는 고정 보상 catalog seed로만 등록합니다.

INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES
  ('castle_ace_box','STACK','🔥에이스 상자(/에이스오픈)',1,JSON_OBJECT('source','legacy-main.js','objectKey','castle_ace_box','sourceCommand','/에이스오픈','useRoute','/패키지사용'),0,1),
  ('castle_emperor_box','STACK','🪽엠퍼러 상자(/엠퍼러오픈)',1,JSON_OBJECT('source','legacy-main.js','objectKey','castle_emperor_box','sourceCommand','/엠퍼러오픈','useRoute','/패키지사용'),0,1),
  ('castle_almighty_box','STACK','🪬올마이티 상자(/올마이티오픈)',1,JSON_OBJECT('source','legacy-main.js','objectKey','castle_almighty_box','sourceCommand','/올마이티오픈','useRoute','/패키지사용'),0,1),
  ('castle_coin','STACK','캐슬코인🥇',1,JSON_OBJECT('source','legacy-main.js','objectKey','castle_coin'),1,1),
  ('pet_enhance_rate_up_30','STACK','펫강화확률UP🌟(30%)',1,JSON_OBJECT('source','legacy-main.js','objectKey','pet_enhance_rate_up_30'),1,1),
  ('pet_enhance_stone','STACK','펫 강화석⭐',1,JSON_OBJECT('source','legacy-main.js','objectKey','pet_enhance_stone'),1,1)
ON DUPLICATE KEY UPDATE item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
SELECT item_id,item_name,item_type,stackable,metadata_json,enabled FROM package_item_definitions
WHERE item_id IN ('castle_ace_box','castle_emperor_box','castle_almighty_box','castle_coin','pet_enhance_rate_up_30','pet_enhance_stone')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),active=VALUES(active),version=version+1;

INSERT INTO package_catalog(package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
  display_order,max_open_count,block_castle,definition_status,enabled,row_version) VALUES
  ('PKG-CASTLE-ACE-BOX','DRAFT-20260826','에이스 상자','캐슬코인 80·30% 펫강화확률UP 3·펫 강화석 800','castle_ace_box','/에이스오픈',45,10000,1,'EXACT_LEGACY_DRAFT',0,1),
  ('PKG-CASTLE-EMPEROR-BOX','DRAFT-20260826','엠퍼러 상자','캐슬코인 300·30% 펫강화확률UP 10·펫 강화석 3500','castle_emperor_box','/엠퍼러오픈',46,10000,1,'EXACT_LEGACY_DRAFT',0,1),
  ('PKG-CASTLE-ALMIGHTY-BOX','DRAFT-20260826','올마이티 상자','캐슬코인 400·30% 펫강화확률UP 15·펫 강화석 4000','castle_almighty_box','/올마이티오픈',47,10000,1,'EXACT_LEGACY_DRAFT',0,1)
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),
  consume_item_id=VALUES(consume_item_id),source_legacy_command=VALUES(source_legacy_command),display_order=VALUES(display_order),
  max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),definition_status=VALUES(definition_status),
  enabled=VALUES(enabled),row_version=row_version+1,deleted_at=NULL,deleted_by=NULL;

DELETE FROM package_reward_rules WHERE package_id IN ('PKG-CASTLE-ACE-BOX','PKG-CASTLE-EMPEROR-BOX','PKG-CASTLE-ALMIGHTY-BOX');

INSERT INTO package_reward_rules(rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
  quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled) VALUES
  ('RULE-PKG-CASTLE-ACE-001','PKG-CASTLE-ACE-BOX',1,'ALL','ALL','ADD','USER','castle_coin',80,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/에이스오픈'),NULL,1),
  ('RULE-PKG-CASTLE-ACE-002','PKG-CASTLE-ACE-BOX',2,'ALL','ALL','ADD','USER','pet_enhance_rate_up_30',3,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/에이스오픈'),NULL,1),
  ('RULE-PKG-CASTLE-ACE-003','PKG-CASTLE-ACE-BOX',3,'ALL','ALL','ADD','USER','pet_enhance_stone',800,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/에이스오픈'),NULL,1),
  ('RULE-PKG-CASTLE-EMPEROR-001','PKG-CASTLE-EMPEROR-BOX',1,'ALL','ALL','ADD','USER','castle_coin',300,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/엠퍼러오픈'),NULL,1),
  ('RULE-PKG-CASTLE-EMPEROR-002','PKG-CASTLE-EMPEROR-BOX',2,'ALL','ALL','ADD','USER','pet_enhance_rate_up_30',10,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/엠퍼러오픈'),NULL,1),
  ('RULE-PKG-CASTLE-EMPEROR-003','PKG-CASTLE-EMPEROR-BOX',3,'ALL','ALL','ADD','USER','pet_enhance_stone',3500,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/엠퍼러오픈'),NULL,1),
  ('RULE-PKG-CASTLE-ALMIGHTY-001','PKG-CASTLE-ALMIGHTY-BOX',1,'ALL','ALL','ADD','USER','castle_coin',400,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/올마이티오픈'),NULL,1),
  ('RULE-PKG-CASTLE-ALMIGHTY-002','PKG-CASTLE-ALMIGHTY-BOX',2,'ALL','ALL','ADD','USER','pet_enhance_rate_up_30',15,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/올마이티오픈'),NULL,1),
  ('RULE-PKG-CASTLE-ALMIGHTY-003','PKG-CASTLE-ALMIGHTY-BOX',3,'ALL','ALL','ADD','USER','pet_enhance_stone',4000,NULL,NULL,NULL,NULL,NULL,JSON_OBJECT('sourceCommand','/올마이티오픈'),NULL,1);

DELETE FROM package_command_aliases WHERE package_id IN ('PKG-CASTLE-ACE-BOX','PKG-CASTLE-EMPEROR-BOX','PKG-CASTLE-ALMIGHTY-BOX');
DELETE FROM command_aliases WHERE command_text IN ('/에이스오픈','/엠퍼러오픈','/올마이티오픈');
