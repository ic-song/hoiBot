-- 길드레이드던전박스는 독립 실행 명령이 아니라 /패키지사용으로 여는 가중 보상 catalog seed로만 등록합니다.

INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES
  ('guild_raid_dungeon_box','STACK','길드레이드던전박스(/레이드박스오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','guild_raid_dungeon_box','sourceCommand','/레이드박스오픈','useRoute','/패키지사용'),0,1),
  ('pet_food','STACK','펫먹이🍼',1,JSON_OBJECT('source','legacy-main.js','objectKey','pet_food'),1,1),
  ('land_document','STACK','땅문서📜',1,JSON_OBJECT('source','legacy-main.js','objectKey','land_document','legacyItemId','ITEM-RWD-039'),1,1),
  ('weekly_box','STACK','주간상자🦋(/주간오픈)',1,JSON_OBJECT('source','legacy-main.js','objectKey','weekly_box','legacyItemId','ITEM-RWD-048'),1,1),
  ('mini_pet_enhance_stone_package','STACK','미니펫강화석패키지💫(/미강오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','mini_pet_enhance_stone_package','legacyItemId','ITEM-PACKAGE-103'),1,1),
  ('mini_pet_draw','STACK','미니펫뽑기🐹(/미니펫오픈)',1,
   JSON_OBJECT('source','legacy-main.js','objectKey','mini_pet_draw','legacyItemId','ITEM-PACKAGE-105'),1,1),
  ('trait_change_book','STACK','특성변경책',1,JSON_OBJECT('source','legacy-main.js','objectKey','trait_change_book'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
SELECT item_id,item_name,item_type,stackable,metadata_json,enabled
FROM package_item_definitions
WHERE item_id IN ('guild_raid_dungeon_box','pet_food','land_document','weekly_box',
                  'mini_pet_enhance_stone_package','mini_pet_draw','trait_change_book')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),active=VALUES(active),version=version+1;

INSERT INTO package_catalog(
  package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
  display_order,max_open_count,block_castle,definition_status,enabled,row_version
) VALUES (
  'PKG-GUILD-RAID-DUNGEON-BOX','DRAFT-20260826','길드레이드던전박스',
  '개봉마다 80/10/4/3/2/1 가중치로 보상 하나 지급',
  'guild_raid_dungeon_box','/레이드박스오픈',44,10000,0,'EXACT_LEGACY_DRAFT',0,1
)
ON DUPLICATE KEY UPDATE
  catalog_version=VALUES(catalog_version),display_name=VALUES(display_name),description=VALUES(description),
  consume_item_id=VALUES(consume_item_id),source_legacy_command=VALUES(source_legacy_command),
  display_order=VALUES(display_order),max_open_count=VALUES(max_open_count),block_castle=VALUES(block_castle),
  definition_status=VALUES(definition_status),enabled=VALUES(enabled),row_version=row_version+1,deleted_at=NULL,deleted_by=NULL;

DELETE FROM package_reward_rules WHERE package_id='PKG-GUILD-RAID-DUNGEON-BOX';

INSERT INTO package_reward_rules(
  rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
  quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json,enabled
) VALUES
  ('RULE-PKG-GUILD-RAID-001','PKG-GUILD-RAID-DUNGEON-BOX',1,'GUILD_RAID_REWARD','WEIGHTED_ONE','ADD','USER','pet_food',350,80,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/레이드박스오픈','objectKey','pet_food','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1),
  ('RULE-PKG-GUILD-RAID-002','PKG-GUILD-RAID-DUNGEON-BOX',2,'GUILD_RAID_REWARD','WEIGHTED_ONE','ADD','USER','land_document',2,10,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/레이드박스오픈','objectKey','land_document','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1),
  ('RULE-PKG-GUILD-RAID-003','PKG-GUILD-RAID-DUNGEON-BOX',3,'GUILD_RAID_REWARD','WEIGHTED_ONE','ADD','USER','weekly_box',1,4,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/레이드박스오픈','objectKey','weekly_box','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1),
  ('RULE-PKG-GUILD-RAID-004','PKG-GUILD-RAID-DUNGEON-BOX',4,'GUILD_RAID_REWARD','WEIGHTED_ONE','ADD','USER','mini_pet_enhance_stone_package',1,3,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/레이드박스오픈','objectKey','mini_pet_enhance_stone_package','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1),
  ('RULE-PKG-GUILD-RAID-005','PKG-GUILD-RAID-DUNGEON-BOX',5,'GUILD_RAID_REWARD','WEIGHTED_ONE','ADD','USER','mini_pet_draw',2000,2,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/레이드박스오픈','objectKey','mini_pet_draw','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1),
  ('RULE-PKG-GUILD-RAID-006','PKG-GUILD-RAID-DUNGEON-BOX',6,'GUILD_RAID_REWARD','WEIGHTED_ONE','ADD','USER','trait_change_book',1,1,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/레이드박스오픈','objectKey','trait_change_book','drawPolicy','PER_OPEN_INDEPENDENT'),NULL,1);

DELETE FROM package_command_aliases WHERE package_id='PKG-GUILD-RAID-DUNGEON-BOX';
DELETE FROM command_aliases WHERE command_text='/레이드박스오픈';
