-- migration 008의 package_reward_bundle_items가 선행되어야 합니다.
-- 레거시 main.js의 29개 독립 패키지 소비 키, 보상 키, 수량, 확률과 metadata를 exact 값으로 보정합니다.
START TRANSACTION;

UPDATE package_rewards SET item_id = 'ITEM-PACKAGE-105' WHERE item_id = 'ITEM-RWD-012';
UPDATE package_reward_rules SET item_id = 'ITEM-PACKAGE-105' WHERE item_id = 'ITEM-RWD-012';
UPDATE package_reward_bundle_items SET item_id = 'ITEM-PACKAGE-105' WHERE item_id = 'ITEM-RWD-012';
DELETE FROM package_item_definitions WHERE item_id = 'ITEM-RWD-012';

-- 축약명이 달라 별도 정의됐던 동일 레거시 item key를 canonical ID로 합칩니다.
UPDATE package_rewards SET item_id = 'ITEM-RWD-001' WHERE item_id = 'ITEM-RWD-013';
UPDATE package_reward_rules SET item_id = 'ITEM-RWD-001' WHERE item_id = 'ITEM-RWD-013';
UPDATE package_reward_bundle_items SET item_id = 'ITEM-RWD-001' WHERE item_id = 'ITEM-RWD-013';
DELETE FROM package_item_definitions WHERE item_id = 'ITEM-RWD-013';

UPDATE package_rewards SET item_id = 'ITEM-RWD-003' WHERE item_id = 'ITEM-RWD-050';
UPDATE package_reward_rules SET item_id = 'ITEM-RWD-003' WHERE item_id = 'ITEM-RWD-050';
UPDATE package_reward_bundle_items SET item_id = 'ITEM-RWD-003' WHERE item_id = 'ITEM-RWD-050';
DELETE FROM package_item_definitions WHERE item_id = 'ITEM-RWD-050';

UPDATE package_rewards SET item_id = 'ITEM-RWD-005' WHERE item_id = 'ITEM-RWD-051';
UPDATE package_reward_rules SET item_id = 'ITEM-RWD-005' WHERE item_id = 'ITEM-RWD-051';
UPDATE package_reward_bundle_items SET item_id = 'ITEM-RWD-005' WHERE item_id = 'ITEM-RWD-051';
DELETE FROM package_item_definitions WHERE item_id = 'ITEM-RWD-051';

UPDATE package_rewards SET item_id = 'ITEM-RWD-018' WHERE item_id = 'ITEM-RWD-046';
UPDATE package_reward_rules SET item_id = 'ITEM-RWD-018' WHERE item_id = 'ITEM-RWD-046';
UPDATE package_reward_bundle_items SET item_id = 'ITEM-RWD-018' WHERE item_id = 'ITEM-RWD-046';
DELETE FROM package_item_definitions WHERE item_id = 'ITEM-RWD-046';

-- 패키지는 운영 전환 전까지 비활성으로 유지하고, 레거시 개봉 범위만 정확히 기록합니다.
UPDATE package_catalog
SET max_open_count = CASE package_id
      WHEN 'PKG-088' THEN 10000
      WHEN 'PKG-105' THEN 3000
      WHEN 'PKG-207' THEN 10000
      WHEN 'PKG-208' THEN 10000
      ELSE 1
    END,
    definition_status = 'EXACT_LEGACY_DRAFT',
    enabled = 0,
    row_version = row_version + 1
WHERE package_id IN (
  'PKG-078','PKG-088','PKG-093','PKG-097','PKG-098','PKG-100','PKG-103','PKG-105',
  'PKG-156','PKG-157','PKG-158','PKG-159','PKG-160','PKG-161','PKG-162','PKG-165',
  'PKG-166','PKG-186','PKG-188','PKG-201','PKG-203','PKG-204','PKG-206','PKG-207',
  'PKG-208','PKG-209','PKG-210','PKG-211','PKG-212'
);

-- package_catalog.enabled=0이 최종 실행 차단선이며, 정의는 검증 가능한 상태로 둡니다.
UPDATE package_item_definitions
SET enabled = 1,
    metadata_json = JSON_SET(
      COALESCE(metadata_json, JSON_OBJECT()),
      '$.definitionStatus', 'EXACT_LEGACY',
      '$.source', 'legacy-main.js'
    ),
    row_version = row_version + 1
WHERE item_id LIKE 'ITEM-PACKAGE-%'
   OR item_id LIKE 'ITEM-RWD-%';

-- 기존 ITEM-RWD ID를 유지하면서 레거시 가방 key를 이모지와 명령 안내까지 exact하게 보정합니다.
UPDATE package_item_definitions
SET item_name = CASE item_id
  WHEN 'ITEM-RWD-001' THEN '펫스윗홈인테리어샵🖼️(/샵오픈)'
  WHEN 'ITEM-RWD-002' THEN '탐험확률UP🗻(20%)'
  WHEN 'ITEM-RWD-003' THEN '길드공헌훈장🌟(/길드공헌 숫자)'
  WHEN 'ITEM-RWD-004' THEN '길드창고패키지🧳(/길드창고패키지오픈'
  WHEN 'ITEM-RWD-005' THEN '확성기📢(/알림 내용 30자)'
  WHEN 'ITEM-RWD-006' THEN '길드자금'
  WHEN 'ITEM-RWD-007' THEN '펫스킬북'
  WHEN 'ITEM-RWD-008' THEN '펜던트'
  WHEN 'ITEM-RWD-009' THEN '펫'
  WHEN 'ITEM-RWD-010' THEN '미니펫'
  WHEN 'ITEM-RWD-011' THEN '포인트'
  WHEN 'ITEM-RWD-012' THEN '미니펫뽑기🐹(/미니펫오픈)'
  WHEN 'ITEM-RWD-013' THEN '펫스윗홈인테리어샵🖼️(/샵오픈)'
  WHEN 'ITEM-RWD-014' THEN '호이베이스볼⚾️(/투수던집니다)'
  WHEN 'ITEM-RWD-015' THEN '환생버섯🍄'
  WHEN 'ITEM-RWD-016' THEN '강화확률뽑기⚒️(/강화뽑기)'
  WHEN 'ITEM-RWD-017' THEN '고대서적📘'
  WHEN 'ITEM-RWD-018' THEN '미니펫 강화석💫'
  WHEN 'ITEM-RWD-019' THEN '미니펫강화확률UP🐷(30%)'
  WHEN 'ITEM-RWD-020' THEN '미니펫 등급표 기반 무작위'
  WHEN 'ITEM-RWD-021' THEN '호이빛💖'
  WHEN 'ITEM-RWD-022' THEN '티어 승급티켓🎟'
  WHEN 'ITEM-RWD-023' THEN '정령 강화석🥀'
  WHEN 'ITEM-RWD-024' THEN '펫먹이특식🥡(/특식오픈)'
  WHEN 'ITEM-RWD-025' THEN '펫먹이🍼'
  WHEN 'ITEM-RWD-026' THEN '펫 강화석⭐'
  WHEN 'ITEM-RWD-027' THEN '럭키박스🍀(/럭키오픈)'
  WHEN 'ITEM-RWD-028' THEN '컬렉션창세 미니펫🐹'
  WHEN 'ITEM-RWD-029' THEN '컬렉션창조 미니펫🐹'
  WHEN 'ITEM-RWD-030' THEN '탐험확률UP🗻(50%)'
  WHEN 'ITEM-RWD-031' THEN '탐험확률UP🗻(40%)'
  WHEN 'ITEM-RWD-032' THEN '탐험확률UP🗻(30%)'
  WHEN 'ITEM-RWD-033' THEN '펫던전 입장권🌋'
  WHEN 'ITEM-RWD-034' THEN '보물지도🗺️'
  WHEN 'ITEM-RWD-035' THEN '미니펫뽑기4🐹(/미니펫뽑기)'
  WHEN 'ITEM-RWD-036' THEN '혼자레이드리셋권😝'
  WHEN 'ITEM-RWD-037' THEN '슬롯코인🪙'
  WHEN 'ITEM-RWD-038' THEN '시탑 부스터🔮'
  WHEN 'ITEM-RWD-039' THEN '땅문서📜'
  WHEN 'ITEM-RWD-040' THEN '🎃|💀|🍬|🍭|🤡|👻|🕯'
  WHEN 'ITEM-RWD-041' THEN '돌멩이🪨'
  WHEN 'ITEM-RWD-042' THEN '캐슬코인🥇'
  WHEN 'ITEM-RWD-043' THEN '레이드타격대인장👑(+600👾)'
  WHEN 'ITEM-RWD-044' THEN '🥕당근이세요?'
  WHEN 'ITEM-RWD-045' THEN '샤넬 컬렉션🎩'
  WHEN 'ITEM-RWD-046' THEN '미니펫 강화석💫'
  WHEN 'ITEM-RWD-047' THEN '경찰과 도둑🚨(/삐뽀삐뽀)'
  WHEN 'ITEM-RWD-048' THEN '주간상자🌼'
  WHEN 'ITEM-RWD-049' THEN '월간상자🌕'
  WHEN 'ITEM-RWD-050' THEN '길드공헌훈장🌟(/길드공헌 숫자)'
  WHEN 'ITEM-RWD-051' THEN '확성기📢(/알림 내용 30자)'
  WHEN 'ITEM-RWD-052' THEN '전설의 돌맹이🗿'
  WHEN 'ITEM-RWD-053' THEN '다이아상자💎(/다이아상자오픈)'
  WHEN 'ITEM-RWD-054' THEN '응? 뭐라 하였느냐 아아..너무 바닥에 있어 들리지가 않는구나👑'
  WHEN 'ITEM-RWD-055' THEN '태초꼬치🍢'
  WHEN 'ITEM-RWD-056' THEN '태초야키🔥'
  WHEN 'ITEM-RWD-057' THEN '태초숯불꼬치♨️'
  WHEN 'ITEM-RWD-058' THEN '태초한판꼬치🥢'
  WHEN 'ITEM-RWD-059' THEN '태초꼬치집🏮'
  WHEN 'ITEM-RWD-060' THEN '태초닭꼬치🐔'
  WHEN 'ITEM-RWD-061' THEN '태초불향꼬치🔥'
  WHEN 'ITEM-RWD-062' THEN '태초한잔꼬치🍶'
  WHEN 'ITEM-RWD-063' THEN '태초꼬치포차🍻'
  WHEN 'ITEM-RWD-064' THEN '태초직화꼬치🔥'
  WHEN 'ITEM-RWD-065' THEN '펫강화확률UP🌟(30%)'
  WHEN 'ITEM-RWD-066' THEN '슬롯대용량상자🧳'
  WHEN 'ITEM-RWD-067' THEN '샤넬 햄스터🐹'
  ELSE item_name
END
WHERE item_id BETWEEN 'ITEM-RWD-001' AND 'ITEM-RWD-067';

-- 객체형 보상은 문자열 note가 아니라 실제 생성 필드를 구조화하여 저장합니다.
UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name','고대서적📘',
  'exp','140000','rate',0.00001,'grade','로열 루미에르',
  'displayName','고대서적📘(+140,000💕)[로열 루미에르]'
) WHERE item_id='ITEM-RWD-017';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name','호이빛','emoji','💖',
  'grade','창조','battleExp','1350000','castleExp','1350000','raidExp','1350000'
) WHERE item_id='ITEM-RWD-021';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name','컬렉션창세 미니펫',
  'emoji','🐹','grade','창세','battleExp','1','price','1'
) WHERE item_id='ITEM-RWD-028';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name','컬렉션창조 미니펫',
  'emoji','🐹','grade','창조','battleExp','1','price','1'
) WHERE item_id='ITEM-RWD-029';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name','샤넬 컬렉션🎩',
  'exp','56050','rate',0,'grade','시그니엘',
  'displayName','샤넬 컬렉션🎩(+56050💕)[시그니엘]'
) WHERE item_id='ITEM-RWD-045';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY',
  'name','응? 뭐라 하였느냐 아아..너무 바닥에 있어 들리지가 않는구나👑',
  'price','100000000'
) WHERE item_id='ITEM-RWD-054';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name',
  CASE item_id
    WHEN 'ITEM-RWD-055' THEN '태초꼬치' WHEN 'ITEM-RWD-056' THEN '태초야키'
    WHEN 'ITEM-RWD-057' THEN '태초숯불꼬치' WHEN 'ITEM-RWD-058' THEN '태초한판꼬치'
    WHEN 'ITEM-RWD-059' THEN '태초꼬치집' WHEN 'ITEM-RWD-060' THEN '태초닭꼬치'
    WHEN 'ITEM-RWD-061' THEN '태초불향꼬치' WHEN 'ITEM-RWD-062' THEN '태초한잔꼬치'
    WHEN 'ITEM-RWD-063' THEN '태초꼬치포차' WHEN 'ITEM-RWD-064' THEN '태초직화꼬치'
  END,
  'emoji',
  CASE item_id
    WHEN 'ITEM-RWD-055' THEN '🍢' WHEN 'ITEM-RWD-056' THEN '🔥'
    WHEN 'ITEM-RWD-057' THEN '♨️' WHEN 'ITEM-RWD-058' THEN '🥢'
    WHEN 'ITEM-RWD-059' THEN '🏮' WHEN 'ITEM-RWD-060' THEN '🐔'
    WHEN 'ITEM-RWD-061' THEN '🔥' WHEN 'ITEM-RWD-062' THEN '🍶'
    WHEN 'ITEM-RWD-063' THEN '🍻' WHEN 'ITEM-RWD-064' THEN '🔥'
  END,
  'grade','태초','battleExp','1','price','1'
) WHERE item_id BETWEEN 'ITEM-RWD-055' AND 'ITEM-RWD-064';

UPDATE package_item_definitions SET metadata_json = JSON_OBJECT(
  'source','legacy-main.js','definitionStatus','EXACT_LEGACY','name','샤넬 햄스터',
  'emoji','🐹','grade','전설','battleExp','30000000','price','999'
) WHERE item_id='ITEM-RWD-067';

-- 낚시는 포인트가 아니라 /정리 대상 생선 STACK을 지급합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-RWD-FISH-001','STACK','잉어🐡',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.1),1,1),
  ('ITEM-RWD-FISH-002','STACK','연어🍣',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.08),1,1),
  ('ITEM-RWD-FISH-003','STACK','고등어🐟',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.08),1,1),
  ('ITEM-RWD-FISH-004','STACK','은갈치🐟',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.07),1,1),
  ('ITEM-RWD-FISH-005','STACK','광어🐠',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.06),1,1),
  ('ITEM-RWD-FISH-006','STACK','오징어🦑',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.06),1,1),
  ('ITEM-RWD-FISH-007','STACK','새우🦐',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.06),1,1),
  ('ITEM-RWD-FISH-008','STACK','문어🐙',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.05),1,1),
  ('ITEM-RWD-FISH-009','STACK','게🦀',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.05),1,1),
  ('ITEM-RWD-FISH-010','STACK','조개🐚',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.05),1,1),
  ('ITEM-RWD-FISH-011','STACK','전복🐚',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.03),1,1),
  ('ITEM-RWD-FISH-012','STACK','장어🐟',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.03),1,1),
  ('ITEM-RWD-FISH-013','STACK','방어🐟',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.03),1,1),
  ('ITEM-RWD-FISH-014','STACK','복어🐡',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.025),1,1),
  ('ITEM-RWD-FISH-015','STACK','참치🐟',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.02),1,1),
  ('ITEM-RWD-FISH-016','STACK','대게🦀',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.02),1,1),
  ('ITEM-RWD-FISH-017','STACK','해마🐴',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.02),1,1),
  ('ITEM-RWD-FISH-018','STACK','랍스터🦞',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.015),1,1),
  ('ITEM-RWD-FISH-019','STACK','참돔🐟',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.01),1,1),
  ('ITEM-RWD-FISH-020','STACK','황금잉어👑',1,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','legacyWeight',0.001),1,1),
  ('ITEM-RWD-FISH-TITLE','MEMBER_TITLE','황금잉어👑를 낚은 전설의 낚시꾼',0,
    JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY',
      'name','황금잉어👑를 낚은 전설의 낚시꾼','price','0','deduplicateBy','name'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

-- 할로윈 외형 후보를 개별 정의하여 균등 DYNAMIC_ITEM 선택 대상으로 사용합니다.
INSERT INTO package_item_definitions
  (item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('ITEM-RWD-HALLOWEEN-001','PET_APPEARANCE','🎃 할로윈 호박',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','🎃','emoji','🎃 할로윈 호박','legacyField','petimg'),1,1),
  ('ITEM-RWD-HALLOWEEN-002','PET_APPEARANCE','💀 해골',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','💀','emoji','💀 해골','legacyField','petimg'),1,1),
  ('ITEM-RWD-HALLOWEEN-003','PET_APPEARANCE','🍬 사탕',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','🍬','emoji','🍬 사탕','legacyField','petimg'),1,1),
  ('ITEM-RWD-HALLOWEEN-004','PET_APPEARANCE','🍭 롤리팝',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','🍭','emoji','🍭 롤리팝','legacyField','petimg'),1,1),
  ('ITEM-RWD-HALLOWEEN-005','PET_APPEARANCE','🤡 광대',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','🤡','emoji','🤡 광대','legacyField','petimg'),1,1),
  ('ITEM-RWD-HALLOWEEN-006','PET_APPEARANCE','👻 유령',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','👻','emoji','👻 유령','legacyField','petimg'),1,1),
  ('ITEM-RWD-HALLOWEEN-007','PET_APPEARANCE','🕯 촛불',0,JSON_OBJECT('source','legacy-main.js','definitionStatus','EXACT_LEGACY','event','HALLOWEEN','name','🕯','emoji','🕯 촛불','legacyField','petimg'),1,1)
ON DUPLICATE KEY UPDATE
  item_type=VALUES(item_type),item_name=VALUES(item_name),stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),enabled=VALUES(enabled),row_version=row_version+1;

-- 길드창고 보상은 사용자 가방이 아니라 길드 소유 자원입니다.
UPDATE package_reward_rules
SET owner_scope='GUILD',
    metadata_override_json=CASE item_id
      WHEN 'ITEM-RWD-006' THEN JSON_OBJECT('legacyField','warehouse.fund')
      WHEN 'ITEM-RWD-007' THEN JSON_OBJECT('legacyField','warehouse.petSkillBook')
      WHEN 'ITEM-RWD-008' THEN JSON_OBJECT('legacyField','warehouse.pendant')
      WHEN 'ITEM-RWD-009' THEN JSON_OBJECT('legacyField','warehouse.pet')
      WHEN 'ITEM-RWD-010' THEN JSON_OBJECT('legacyField','warehouse.miniPet')
    END
WHERE package_id='PKG-088';

-- /홈패키지오픈2의 돌멩이는 레거시 exact 2,000개입니다.
UPDATE package_reward_rules
SET quantity=2000,
    metadata_override_json=JSON_OBJECT('source','legacy-main.js','exactQuantity',2000)
WHERE rule_id='RULE-PKG-201-003';

-- 객체 생성 시 필요한 구조화 metadata를 규칙에도 명시합니다.
UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','고대서적📘','exp','140000','rate',0.00001,'grade','로열 루미에르',
  'displayName','고대서적📘(+140,000💕)[로열 루미에르]'
) WHERE rule_id='RULE-PKG-100-001';

UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','호이빛','emoji','💖','grade','창조','battleExp','1350000',
  'castleExp','1350000','raidExp','1350000'
) WHERE rule_id='RULE-PKG-156-001';

UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','컬렉션창세 미니펫','emoji','🐹','grade','창세','battleExp','1','price','1'
) WHERE rule_id='RULE-PKG-165-002';

UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','컬렉션창조 미니펫','emoji','🐹','grade','창조','battleExp','1','price','1'
) WHERE rule_id IN ('RULE-PKG-166-002','RULE-PKG-204-022');

UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','샤넬 컬렉션🎩','exp','56050','rate',0,'grade','시그니엘',
  'displayName','샤넬 컬렉션🎩(+56050💕)[시그니엘]'
) WHERE rule_id='RULE-PKG-203-007';

UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','응? 뭐라 하였느냐 아아..너무 바닥에 있어 들리지가 않는구나👑',
  'price','100000000'
) WHERE rule_id='RULE-PKG-204-023';

UPDATE package_reward_rules r
JOIN package_item_definitions i ON i.item_id=r.item_id
SET r.metadata_override_json=JSON_OBJECT(
  'name',JSON_UNQUOTE(JSON_EXTRACT(i.metadata_json,'$.name')),
  'emoji',JSON_UNQUOTE(JSON_EXTRACT(i.metadata_json,'$.emoji')),
  'grade','태초','battleExp','1','price','1'
)
WHERE r.package_id='PKG-206' AND r.item_id BETWEEN 'ITEM-RWD-055' AND 'ITEM-RWD-064';

UPDATE package_reward_rules SET metadata_override_json=JSON_OBJECT(
  'name','샤넬 햄스터','emoji','🐹','grade','전설','battleExp','30000000','price','999'
) WHERE rule_id='RULE-PKG-212-006';

-- /미니펫오픈은 migration 008의 등급/후보 카탈로그를 사용하고 성공 수만 소비합니다.
UPDATE package_reward_rules
SET metadata_override_json=JSON_OBJECT(
      'maxOpenCount',3000,
      'consumeOnlySuccessCount',TRUE,
      'capacityPolicy','START_MUST_HAVE_SPACE',
      'gradeCatalog','miniPetData.gradeTable',
      'itemCatalog','miniPetData.miniPet'
    ),
    selector_json=JSON_OBJECT(
      'itemType','MINI_PET',
      'catalogCode','legacy-mini-pet',
      'respectCapacity',TRUE,
      'consumeOnlyGranted',TRUE
    )
WHERE rule_id='RULE-PKG-105-001';

-- 할로윈 외형은 요청 펫에 7종 중 하나를 균등 교체합니다.
UPDATE package_reward_rules
SET owner_scope='TARGET_PET',
    target_selector='REQUESTED_PET',
    metadata_override_json=JSON_OBJECT(
      'choices',JSON_ARRAY('🎃','💀','🍬','🍭','🤡','👻','🕯'),
      'legacyField','petimg'
    ),
    selector_json=JSON_OBJECT(
      'itemType','PET_APPEARANCE',
      'metadataEquals',JSON_OBJECT('event','HALLOWEEN')
    )
WHERE rule_id='RULE-PKG-188-007';

-- 기존 포인트형 낚시 규칙을 제거하고 실패 30% + 성공 70% 내부 0.861 정규화로 재구성합니다.
DELETE FROM package_reward_bundle_items
WHERE parent_rule_id LIKE 'RULE-PKG-093-%';

DELETE FROM package_reward_rules
WHERE package_id='PKG-093';

INSERT INTO package_reward_rules
  (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
   quantity,weight,range_min,range_max,range_step,target_selector,
   metadata_override_json,selector_json,enabled)
VALUES
  ('RULE-PKG-093-001-NONE','PKG-093',1,'FISHING','WEIGHTED_ONE','NONE','USER',NULL,
   0,0.3000000000,NULL,NULL,NULL,NULL,
   JSON_OBJECT('result','NO_REWARD','legacyFailureProbability',0.3),NULL,1),
  ('RULE-PKG-093-002','PKG-093',2,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-001',90,0.0813008130,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.1,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-003','PKG-093',3,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-002',30,0.0650406504,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.08,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-004','PKG-093',4,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-003',90,0.0650406504,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.08,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-005','PKG-093',5,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-004',90,0.0569105691,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.07,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-006','PKG-093',6,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-005',300,0.0487804878,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.06,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-007','PKG-093',7,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-006',90,0.0487804878,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.06,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-008','PKG-093',8,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-007',60,0.0487804878,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.06,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-009','PKG-093',9,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-008',60,0.0406504065,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.05,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-010','PKG-093',10,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-009',360,0.0406504065,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.05,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-011','PKG-093',11,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-010',450,0.0406504065,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.05,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-012','PKG-093',12,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-011',750,0.0243902439,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.03,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-013','PKG-093',13,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-012',900,0.0243902439,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.03,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-014','PKG-093',14,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-013',840,0.0243902439,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.03,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-015','PKG-093',15,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-014',540,0.0203252033,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.025,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-016','PKG-093',16,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-015',1200,0.0162601626,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.02,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-017','PKG-093',17,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-016',1350,0.0162601626,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.02,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-018','PKG-093',18,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-017',600,0.0162601626,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.02,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-019','PKG-093',19,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-018',1500,0.0121951220,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.015,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-020','PKG-093',20,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-019',900,0.0081300813,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.01,'legacySuccessWeightTotal',0.861),NULL,1),
  ('RULE-PKG-093-021','PKG-093',21,'FISHING','WEIGHTED_ONE','ADD','USER','ITEM-RWD-FISH-020',100000,0.0008130081,NULL,NULL,NULL,NULL,JSON_OBJECT('legacyWeight',0.001,'legacySuccessWeightTotal',0.861),NULL,1);

-- 황금잉어 결과에만 중복 이름 방지 MEMBER_TITLE을 함께 지급합니다.
INSERT INTO package_reward_bundle_items
  (bundle_item_id,parent_rule_id,reward_order,operation,owner_scope,item_id,quantity,target_selector,metadata_override_json,enabled)
VALUES
  ('BUNDLE-PKG-093-GOLDEN-TITLE','RULE-PKG-093-021',1,'ADD','USER','ITEM-RWD-FISH-TITLE',1,NULL,
   JSON_OBJECT('name','황금잉어👑를 낚은 전설의 낚시꾼','price','0','deduplicateBy','name'),1)
ON DUPLICATE KEY UPDATE
  item_id=VALUES(item_id),quantity=VALUES(quantity),owner_scope=VALUES(owner_scope),
  target_selector=VALUES(target_selector),metadata_override_json=VALUES(metadata_override_json),enabled=1;

-- 보정 후에도 29개 패키지의 실행 스위치는 닫아 둡니다.
UPDATE package_catalog
SET definition_status='EXACT_LEGACY_DRAFT',enabled=0,row_version=row_version+1
WHERE package_id IN (
  'PKG-078','PKG-088','PKG-093','PKG-097','PKG-098','PKG-100','PKG-103','PKG-105',
  'PKG-156','PKG-157','PKG-158','PKG-159','PKG-160','PKG-161','PKG-162','PKG-165',
  'PKG-166','PKG-186','PKG-188','PKG-201','PKG-203','PKG-204','PKG-206','PKG-207',
  'PKG-208','PKG-209','PKG-210','PKG-211','PKG-212'
);

UPDATE package_item_definitions
SET enabled=0,row_version=row_version+1
WHERE item_id LIKE 'ITEM-RWD-%'
   OR item_id LIKE 'ITEM-APPEARANCE-HALLOWEEN-%'
   OR item_id LIKE 'ITEM-PACKAGE-%';

COMMIT;

