START TRANSACTION;

-- 개별 개봉 문자열은 실행 alias가 아니라 패키지 카탈로그의 레거시 출처로만 보존합니다.
ALTER TABLE package_catalog
  ADD COLUMN IF NOT EXISTS source_legacy_command VARCHAR(191) NULL AFTER consume_item_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_source_legacy_command
  ON package_catalog(source_legacy_command);

-- 시트에 추가된 다이아·랜덤·펫먹이상자 패키지와 랜덤 보상 원자를 비활성 seed로 등록합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-PACKAGE-213','STACK','💎다이아 상자(/다이아오픈)',1,
   JSON_OBJECT('source','legacy-main.js','sourceCommand','/다이아오픈','useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-PACKAGE-214','STACK','랜덤박스💝',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','random_box','sourceCommand','/랜덤오픈','useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-RWD-PET-FOOD-BOX','STACK','펫먹이상자📦(/상자오픈)',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','pet_food_box','sourceCommand','/상자오픈','useRoute','/패키지사용','migrationPolicy','CATALOG_SEED_ONLY'),0,1),
  ('ITEM-RWD-RANDOM-SPIRIT-BOX','STACK','정령상자🥀',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','spirit_box'),0,1),
  ('ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20','STACK','영지절대방어권🛡(20%)',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','territory_defense_ticket'),0,1),
  ('ITEM-RWD-RANDOM-TERRITORY-ATTACK-10','STACK','영지기습공격권🔥(10%)',1,
   JSON_OBJECT('source','legacy-main.js','legacyItemCode','territory_attack_ticket'),0,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=0;

INSERT INTO item_definitions
  (code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT item_id,item_name,'PACKAGE_ITEM',stackable,metadata_json,0,1
FROM package_item_definitions
WHERE item_id IN (
  'ITEM-PACKAGE-213','ITEM-PACKAGE-214','ITEM-RWD-PET-FOOD-BOX',
  'ITEM-RWD-RANDOM-SPIRIT-BOX','ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20',
  'ITEM-RWD-RANDOM-TERRITORY-ATTACK-10'
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=0;

INSERT INTO package_catalog
  (package_id,catalog_version,display_name,description,consume_item_id,source_legacy_command,
   display_order,max_open_count,block_castle,definition_status,enabled,row_version)
VALUES
  ('PKG-213','DRAFT-20260825','💎다이아 상자','캐슬코인·펫 강화 원자 고정 보상',
   'ITEM-PACKAGE-213','/다이아오픈',32,1,1,'EXACT_LEGACY_DRAFT',0,1),
  ('PKG-214','DRAFT-20260825','랜덤박스💝','6개 후보 균등 랜덤 보상',
   'ITEM-PACKAGE-214','/랜덤오픈',33,10000,1,'EXACT_LEGACY_DRAFT',0,1),
  ('PKG-215','DRAFT-20260825','펫먹이상자📦','50·100·250·500 펫먹이 가중 보상',
   'ITEM-RWD-PET-FOOD-BOX','/상자오픈',34,10000,1,'EXACT_LEGACY_DRAFT',0,1)
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
  ('RULE-PKG-213-001','PKG-213',1,'ALL','ALL','ADD','USER','ITEM-RWD-042',200,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아오픈'),NULL,1),
  ('RULE-PKG-213-002','PKG-213',2,'ALL','ALL','ADD','USER','ITEM-RWD-065',6,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아오픈'),NULL,1),
  ('RULE-PKG-213-003','PKG-213',3,'ALL','ALL','ADD','USER','ITEM-RWD-026',2200,NULL,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/다이아오픈'),NULL,1),
  ('RULE-PKG-214-001','PKG-214',1,'RANDOM','WEIGHTED_ONE','ADD','USER','ITEM-RWD-TRASH-BOX',1,0.1666666667,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','trash_box'),NULL,1),
  ('RULE-PKG-214-002','PKG-214',2,'RANDOM','WEIGHTED_ONE','ADD','USER','ITEM-RWD-RANDOM-SPIRIT-BOX',1,0.1666666667,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','spirit_box'),NULL,1),
  ('RULE-PKG-214-003','PKG-214',3,'RANDOM','WEIGHTED_ONE','ADD','USER','ITEM-PACKAGE-CHICKEN-BOX',1,0.1666666667,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','chicken_box'),NULL,1),
  ('RULE-PKG-214-004','PKG-214',4,'RANDOM','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',1,0.1666666667,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','pet_food'),NULL,1),
  ('RULE-PKG-214-005','PKG-214',5,'RANDOM','WEIGHTED_ONE','ADD','USER','ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20',1,0.1666666667,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','territory_defense_ticket'),NULL,1),
  ('RULE-PKG-214-006','PKG-214',6,'RANDOM','WEIGHTED_ONE','ADD','USER','ITEM-RWD-RANDOM-TERRITORY-ATTACK-10',1,0.1666666667,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/랜덤오픈','legacyItemCode','territory_attack_ticket'),NULL,1),
  ('RULE-PKG-215-001','PKG-215',1,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',50,0.9815000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/상자오픈','legacyWeight',9815),NULL,1),
  ('RULE-PKG-215-002','PKG-215',2,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',100,0.0150000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/상자오픈','legacyWeight',150),NULL,1),
  ('RULE-PKG-215-003','PKG-215',3,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',250,0.0030000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/상자오픈','legacyWeight',30),NULL,1),
  ('RULE-PKG-215-004','PKG-215',4,'PET_FOOD_BOX','WEIGHTED_ONE','ADD','USER','ITEM-RWD-025',500,0.0005000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('sourceCommand','/상자오픈','legacyWeight',5),NULL,1)
ON DUPLICATE KEY UPDATE
  package_id=VALUES(package_id),reward_order=VALUES(reward_order),group_code=VALUES(group_code),
  rule_mode=VALUES(rule_mode),operation=VALUES(operation),owner_scope=VALUES(owner_scope),
  item_id=VALUES(item_id),quantity=VALUES(quantity),weight=VALUES(weight),
  range_min=VALUES(range_min),range_max=VALUES(range_max),range_step=VALUES(range_step),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),
  selector_json=VALUES(selector_json),enabled=1;

UPDATE package_catalog
SET source_legacy_command=CASE package_id
    WHEN 'PKG-078' THEN '/고생하셨습니다'
    WHEN 'PKG-088' THEN '/길드창고패키지오픈'
    WHEN 'PKG-093' THEN '/낚시오픈'
    WHEN 'PKG-097' THEN '/도파민오픈1'
    WHEN 'PKG-098' THEN '/도파민오픈2'
    WHEN 'PKG-100' THEN '/로열오픈'
    WHEN 'PKG-103' THEN '/미강오픈'
    WHEN 'PKG-105' THEN '/미니펫오픈'
    WHEN 'PKG-156' THEN '/창조오픈'
    WHEN 'PKG-157' THEN '/초보오픈1'
    WHEN 'PKG-158' THEN '/초보오픈2'
    WHEN 'PKG-159' THEN '/초보오픈3'
    WHEN 'PKG-160' THEN '/초보오픈4'
    WHEN 'PKG-161' THEN '/초보오픈5'
    WHEN 'PKG-162' THEN '/초보오픈6'
    WHEN 'PKG-165' THEN '/컬렉션창세오픈'
    WHEN 'PKG-166' THEN '/컬렉션창조오픈'
    WHEN 'PKG-186' THEN '/펫탐험오픈1'
    WHEN 'PKG-188' THEN '/해피할로윈오픈시펫외형이바뀝니다안에는어마어마한상품이있습니다'
    WHEN 'PKG-201' THEN '/홈패키지오픈2'
    WHEN 'PKG-203' THEN '/홈패키지오픈테스트'
    WHEN 'PKG-204' THEN '/황제패키지오픈3'
    WHEN 'PKG-206' THEN '/이랏싸이마쎄'
    WHEN 'PKG-207' THEN '/극락오픈'
    WHEN 'PKG-208' THEN '/나락오픈'
    WHEN 'PKG-209' THEN '/루비오픈'
    WHEN 'PKG-210' THEN '/루키오픈'
    WHEN 'PKG-211' THEN '/마스터오픈'
    WHEN 'PKG-212' THEN '/미니오픈테스트'
    WHEN 'PKG-213' THEN '/다이아오픈'
    WHEN 'PKG-214' THEN '/랜덤오픈'
    WHEN 'PKG-215' THEN '/상자오픈'
    WHEN 'PKG-CHICKEN-BOX' THEN '/치킨오픈'
    WHEN 'PKG-CASTLE-CARD' THEN '/카드오픈'
  END,
  enabled=0
WHERE package_id IN ('PKG-078','PKG-088','PKG-093','PKG-097','PKG-098','PKG-100','PKG-103','PKG-105','PKG-156','PKG-157','PKG-158','PKG-159','PKG-160','PKG-161','PKG-162','PKG-165','PKG-166','PKG-186','PKG-188','PKG-201','PKG-203','PKG-204','PKG-206','PKG-207','PKG-208','PKG-209','PKG-210','PKG-211','PKG-212','PKG-213','PKG-214','PKG-215','PKG-CHICKEN-BOX','PKG-CASTLE-CARD');

-- 레거시 명령 문자열은 어느 경우에도 직접 실행 alias로 남기지 않습니다.
DELETE FROM package_command_aliases
WHERE package_id IN ('PKG-078','PKG-088','PKG-093','PKG-097','PKG-098','PKG-100','PKG-103','PKG-105','PKG-156','PKG-157','PKG-158','PKG-159','PKG-160','PKG-161','PKG-162','PKG-165','PKG-166','PKG-186','PKG-188','PKG-201','PKG-203','PKG-204','PKG-206','PKG-207','PKG-208','PKG-209','PKG-210','PKG-211','PKG-212','PKG-213','PKG-214','PKG-215','PKG-CHICKEN-BOX','PKG-CASTLE-CARD');

COMMIT;

