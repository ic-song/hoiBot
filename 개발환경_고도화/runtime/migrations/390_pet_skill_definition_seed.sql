START TRANSACTION;

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_000', '청룡언월도', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"청룡언월도","grade":"S","rate":0.1,"fixedRate":true,"raidExp":1000000,"castleExp":1000000,"effect":"삼국지 관우의 전설적인 무기입니다.\\n장착 시 레이드매력 100만과 캐슬매력 100만, 총 종합매력 200만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":0,"sourceKey":"skill_000","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"청룡언월도","grade":"S","rate":0.1,"fixedRate":true,"raidExp":1000000,"castleExp":1000000,"effect":"삼국지 관우의 전설적인 무기입니다.\\n장착 시 레이드매력 100만과 캐슬매력 100만, 총 종합매력 200만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":0,"sourceKey":"skill_000","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_000', 'SKILL', '청룡언월도', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_000","sourceIndex":0,"sourceKey":"skill_000","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0.1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '청룡언월도'
FROM object_registry WHERE object_key = 'skill.pet_skill_000';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_000'
FROM object_registry WHERE object_key = 'skill.pet_skill_000';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_001', '탈세자', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"탈세자","grade":"SS","rate":0.2,"effect":"상점(길드상점 제외) 구매 시 세금의 70%를 면제받습니다.","sourceIndex":1,"sourceKey":"skill_001","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"탈세자","grade":"SS","rate":0.2,"effect":"상점(길드상점 제외) 구매 시 세금의 70%를 면제받습니다.","sourceIndex":1,"sourceKey":"skill_001","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_001', 'SKILL', '탈세자', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_001","sourceIndex":1,"sourceKey":"skill_001","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"SS","rate":0.2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '탈세자'
FROM object_registry WHERE object_key = 'skill.pet_skill_001';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_001'
FROM object_registry WHERE object_key = 'skill.pet_skill_001';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_002', '엘리트 박사', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"엘리트 박사","grade":"SS","rate":0.2,"raidExp":1500000,"castleExp":1500000,"charmCondition":"eliteMiniPet","effect":"미니펫 [엘리트] 등급을 장착하면 레이드매력 150만과 캐슬매력 150만, 총 종합매력 300만을 획득합니다.\\n펫스킬 해제 또는 발동 조건 미충족 시 지급된 매력은 회수됩니다.","sourceIndex":2,"sourceKey":"skill_002","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"엘리트 박사","grade":"SS","rate":0.2,"raidExp":1500000,"castleExp":1500000,"charmCondition":"eliteMiniPet","effect":"미니펫 [엘리트] 등급을 장착하면 레이드매력 150만과 캐슬매력 150만, 총 종합매력 300만을 획득합니다.\\n펫스킬 해제 또는 발동 조건 미충족 시 지급된 매력은 회수됩니다.","sourceIndex":2,"sourceKey":"skill_002","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_002', 'SKILL', '엘리트 박사', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_002","sourceIndex":2,"sourceKey":"skill_002","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"SS","rate":0.2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '엘리트 박사'
FROM object_registry WHERE object_key = 'skill.pet_skill_002';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_002'
FROM object_registry WHERE object_key = 'skill.pet_skill_002';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_003', '오딘의 뿅망치', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"오딘의 뿅망치","grade":"SS","rate":0.2,"raidExp":2000000,"castleExp":2000000,"effect":"오딘이 적을 응징할 때 사용하던 전설의 뿅망치입니다.\\n장착 시 레이드매력 200만과 캐슬매력 200만, 총 종합매력 400만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":3,"sourceKey":"skill_003","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"오딘의 뿅망치","grade":"SS","rate":0.2,"raidExp":2000000,"castleExp":2000000,"effect":"오딘이 적을 응징할 때 사용하던 전설의 뿅망치입니다.\\n장착 시 레이드매력 200만과 캐슬매력 200만, 총 종합매력 400만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":3,"sourceKey":"skill_003","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_003', 'SKILL', '오딘의 뿅망치', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_003","sourceIndex":3,"sourceKey":"skill_003","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"SS","rate":0.2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '오딘의 뿅망치'
FROM object_registry WHERE object_key = 'skill.pet_skill_003';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_003'
FROM object_registry WHERE object_key = 'skill.pet_skill_003';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_004', '인테리어 장인', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"인테리어 장인","grade":"S","rate":0.7,"effect":"펫스윗홈에 장착된 가구가 10% 매력 효과를 추가로 얻습니다.","sourceIndex":4,"sourceKey":"skill_004","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"인테리어 장인","grade":"S","rate":0.7,"effect":"펫스윗홈에 장착된 가구가 10% 매력 효과를 추가로 얻습니다.","sourceIndex":4,"sourceKey":"skill_004","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_004', 'SKILL', '인테리어 장인', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_004","sourceIndex":4,"sourceKey":"skill_004","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '인테리어 장인'
FROM object_registry WHERE object_key = 'skill.pet_skill_004';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_004'
FROM object_registry WHERE object_key = 'skill.pet_skill_004';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_god_building_owner', '하느님 위에 갓물주', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"하느님 위에 갓물주","grade":"S","rate":0.8,"effect":"/펫홈에 장착할 수 있는 가구를 15개 늘려줍니다.","sourceIndex":5,"sourceKey":"skill_005","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"하느님 위에 갓물주","grade":"S","rate":0.8,"effect":"/펫홈에 장착할 수 있는 가구를 15개 늘려줍니다.","sourceIndex":5,"sourceKey":"skill_005","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_005', 'SKILL', '하느님 위에 갓물주', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_god_building_owner","sourceIndex":5,"sourceKey":"skill_005","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0.8,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '하느님 위에 갓물주'
FROM object_registry WHERE object_key = 'skill.pet_skill_005';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_005'
FROM object_registry WHERE object_key = 'skill.pet_skill_005';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_006', '호이행복재단 회원권', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"호이행복재단 회원권","grade":"S","rate":0.9,"effect":"/이체 사용 시 수수료 50% 할인됩니다.","sourceIndex":6,"sourceKey":"skill_006","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"호이행복재단 회원권","grade":"S","rate":0.9,"effect":"/이체 사용 시 수수료 50% 할인됩니다.","sourceIndex":6,"sourceKey":"skill_006","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_006', 'SKILL', '호이행복재단 회원권', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_006","sourceIndex":6,"sourceKey":"skill_006","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0.9,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '호이행복재단 회원권'
FROM object_registry WHERE object_key = 'skill.pet_skill_006';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_006'
FROM object_registry WHERE object_key = 'skill.pet_skill_006';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_007', '장미칼', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"장미칼","grade":"A","rate":0.4,"fixedRate":true,"raidExp":500000,"castleExp":500000,"effect":"사악한 마녀의 칼입니다.\\n장착 시 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":7,"sourceKey":"skill_007","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"장미칼","grade":"A","rate":0.4,"fixedRate":true,"raidExp":500000,"castleExp":500000,"effect":"사악한 마녀의 칼입니다.\\n장착 시 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":7,"sourceKey":"skill_007","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_007', 'SKILL', '장미칼', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_007","sourceIndex":7,"sourceKey":"skill_007","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0.4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '장미칼'
FROM object_registry WHERE object_key = 'skill.pet_skill_007';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_007'
FROM object_registry WHERE object_key = 'skill.pet_skill_007';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_008', '약탈자', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"약탈자","grade":"S","rate":1,"effect":"/미니펫대전 시 70% 확률로 상대의 1000만 포인트를 훔칩니다.","sourceIndex":8,"sourceKey":"skill_008","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"약탈자","grade":"S","rate":1,"effect":"/미니펫대전 시 70% 확률로 상대의 1000만 포인트를 훔칩니다.","sourceIndex":8,"sourceKey":"skill_008","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_008', 'SKILL', '약탈자', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_008","sourceIndex":8,"sourceKey":"skill_008","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '약탈자'
FROM object_registry WHERE object_key = 'skill.pet_skill_008';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_008'
FROM object_registry WHERE object_key = 'skill.pet_skill_008';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_max_level_hunter', '만렙헌터', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"만렙헌터","grade":"S","rate":1.1,"effect":"/미니펫대전 시 15% 확률로 미니펫뽑기 1개 획득","sourceIndex":9,"sourceKey":"skill_009","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"만렙헌터","grade":"S","rate":1.1,"effect":"/미니펫대전 시 15% 확률로 미니펫뽑기 1개 획득","sourceIndex":9,"sourceKey":"skill_009","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_009', 'SKILL', '만렙헌터', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_max_level_hunter","sourceIndex":9,"sourceKey":"skill_009","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1.1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '만렙헌터'
FROM object_registry WHERE object_key = 'skill.pet_skill_009';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_009'
FROM object_registry WHERE object_key = 'skill.pet_skill_009';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('SKILL-ARTISANS-BREATH', '장인의 숨결', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"장인의 숨결","grade":"S","rate":1,"effect":"/펫강화, /정령강화 실패 시 7% 확률로 강화석이 소모되지 않습니다.","sourceIndex":10,"sourceKey":"skill_010","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"장인의 숨결","grade":"S","rate":1,"effect":"/펫강화, /정령강화 실패 시 7% 확률로 강화석이 소모되지 않습니다.","sourceIndex":10,"sourceKey":"skill_010","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_010', 'SKILL', '장인의 숨결', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"SKILL-ARTISANS-BREATH","sourceIndex":10,"sourceKey":"skill_010","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '장인의 숨결'
FROM object_registry WHERE object_key = 'skill.pet_skill_010';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_010'
FROM object_registry WHERE object_key = 'skill.pet_skill_010';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_011', '전투형 지휘관', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"전투형 지휘관","grade":"S","rate":1,"effect":"길드마스터 전용 스킬입니다.\\n길드마스터가 소드마스터가 아니어도 길드영지전에 참여할 수 있으며, 길드 전체 영지공격 가능 횟수가 5회 증가합니다.","sourceIndex":11,"sourceKey":"skill_011","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"전투형 지휘관","grade":"S","rate":1,"effect":"길드마스터 전용 스킬입니다.\\n길드마스터가 소드마스터가 아니어도 길드영지전에 참여할 수 있으며, 길드 전체 영지공격 가능 횟수가 5회 증가합니다.","sourceIndex":11,"sourceKey":"skill_011","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_011', 'SKILL', '전투형 지휘관', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_011","sourceIndex":11,"sourceKey":"skill_011","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '전투형 지휘관'
FROM object_registry WHERE object_key = 'skill.pet_skill_011';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_011'
FROM object_registry WHERE object_key = 'skill.pet_skill_011';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_knight_reinforcement', '기사단 증원', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"기사단 증원","grade":"S","rate":1,"effect":"길드마스터 전용 스킬입니다.\\n영지전에 참여 가능한 소드마스터 인원이 1명 추가됩니다.","sourceIndex":12,"sourceKey":"skill_012","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"기사단 증원","grade":"S","rate":1,"effect":"길드마스터 전용 스킬입니다.\\n영지전에 참여 가능한 소드마스터 인원이 1명 추가됩니다.","sourceIndex":12,"sourceKey":"skill_012","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_012', 'SKILL', '기사단 증원', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_knight_reinforcement","sourceIndex":12,"sourceKey":"skill_012","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '기사단 증원'
FROM object_registry WHERE object_key = 'skill.pet_skill_012';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_012'
FROM object_registry WHERE object_key = 'skill.pet_skill_012';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_013', '타고난 장사꾼', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"타고난 장사꾼","grade":"S","rate":1,"effect":"자유시장 거래에 물품 등록 가능 건수가 +2건 늘어납니다.","sourceIndex":13,"sourceKey":"skill_013","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"타고난 장사꾼","grade":"S","rate":1,"effect":"자유시장 거래에 물품 등록 가능 건수가 +2건 늘어납니다.","sourceIndex":13,"sourceKey":"skill_013","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_013', 'SKILL', '타고난 장사꾼', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_013","sourceIndex":13,"sourceKey":"skill_013","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '타고난 장사꾼'
FROM object_registry WHERE object_key = 'skill.pet_skill_013';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_013'
FROM object_registry WHERE object_key = 'skill.pet_skill_013';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_014', '창조림', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"창조림","grade":"S","rate":1,"effect":"미니펫 [창조] 등급 장착 시 레이드매력 50만 + 캐슬매력 50만(종합매력 100만)을 획득합니다.\\n조건 해제 시 보너스도 함께 회수됩니다.","sourceIndex":14,"sourceKey":"skill_014","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"창조림","grade":"S","rate":1,"effect":"미니펫 [창조] 등급 장착 시 레이드매력 50만 + 캐슬매력 50만(종합매력 100만)을 획득합니다.\\n조건 해제 시 보너스도 함께 회수됩니다.","sourceIndex":14,"sourceKey":"skill_014","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_014', 'SKILL', '창조림', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_014","sourceIndex":14,"sourceKey":"skill_014","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '창조림'
FROM object_registry WHERE object_key = 'skill.pet_skill_014';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_014'
FROM object_registry WHERE object_key = 'skill.pet_skill_014';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_015', '엑스칼리버', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"엑스칼리버","grade":"S","rate":0.1,"fixedRate":true,"raidExp":1000000,"castleExp":1000000,"effect":"선택받은 자만이 사용할 수 있는 전설의 성검입니다.\\n장착 시 레이드매력 100만과 캐슬매력 100만, 총 종합매력 200만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":15,"sourceKey":"skill_015","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"엑스칼리버","grade":"S","rate":0.1,"fixedRate":true,"raidExp":1000000,"castleExp":1000000,"effect":"선택받은 자만이 사용할 수 있는 전설의 성검입니다.\\n장착 시 레이드매력 100만과 캐슬매력 100만, 총 종합매력 200만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":15,"sourceKey":"skill_015","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_015', 'SKILL', '엑스칼리버', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_015","sourceIndex":15,"sourceKey":"skill_015","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0.1,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '엑스칼리버'
FROM object_registry WHERE object_key = 'skill.pet_skill_015';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_015'
FROM object_registry WHERE object_key = 'skill.pet_skill_015';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_ten_won', '십원', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"십원","grade":"A","rate":1.5,"effect":"시련의탑 40% 확률로 순간 매력 100만 지원","sourceIndex":16,"sourceKey":"skill_016","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"십원","grade":"A","rate":1.5,"effect":"시련의탑 40% 확률로 순간 매력 100만 지원","sourceIndex":16,"sourceKey":"skill_016","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_016', 'SKILL', '십원', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_ten_won","sourceIndex":16,"sourceKey":"skill_016","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '십원'
FROM object_registry WHERE object_key = 'skill.pet_skill_016';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_016'
FROM object_registry WHERE object_key = 'skill.pet_skill_016';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('SKILL-MINI-PET-DOG-MASTER', '개통령', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"개통령","grade":"A","rate":1.4,"effect":"/미니펫강화 성공 확률 10% 증가","sourceIndex":17,"sourceKey":"skill_017","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"개통령","grade":"A","rate":1.4,"effect":"/미니펫강화 성공 확률 10% 증가","sourceIndex":17,"sourceKey":"skill_017","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_017', 'SKILL', '개통령', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"SKILL-MINI-PET-DOG-MASTER","sourceIndex":17,"sourceKey":"skill_017","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '개통령'
FROM object_registry WHERE object_key = 'skill.pet_skill_017';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_017'
FROM object_registry WHERE object_key = 'skill.pet_skill_017';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_018', '숙련된 전사', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"숙련된 전사","grade":"A","rate":1.7,"effect":"/캐슬대전 시 50% 확률로 매력 +20 획득","sourceIndex":18,"sourceKey":"skill_018","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"숙련된 전사","grade":"A","rate":1.7,"effect":"/캐슬대전 시 50% 확률로 매력 +20 획득","sourceIndex":18,"sourceKey":"skill_018","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_018', 'SKILL', '숙련된 전사', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_018","sourceIndex":18,"sourceKey":"skill_018","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '숙련된 전사'
FROM object_registry WHERE object_key = 'skill.pet_skill_018';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_018'
FROM object_registry WHERE object_key = 'skill.pet_skill_018';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_019', '로열 하우스', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"로열 하우스","grade":"A","rate":1.6,"effect":"가구 [로열 루미에르]를 10개 이상  레이드/캐슬 매력 15만 증가(총:종합매력 30만 증가)\\n펫스킬을 해제하면 매력은 회수됩니다.","sourceIndex":19,"sourceKey":"skill_019","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"로열 하우스","grade":"A","rate":1.6,"effect":"가구 [로열 루미에르]를 10개 이상  레이드/캐슬 매력 15만 증가(총:종합매력 30만 증가)\\n펫스킬을 해제하면 매력은 회수됩니다.","sourceIndex":19,"sourceKey":"skill_019","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_019', 'SKILL', '로열 하우스', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_019","sourceIndex":19,"sourceKey":"skill_019","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.6,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '로열 하우스'
FROM object_registry WHERE object_key = 'skill.pet_skill_019';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_019'
FROM object_registry WHERE object_key = 'skill.pet_skill_019';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_020', '셀럽', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"셀럽","grade":"A","rate":1.5,"fixedRate":true,"followerBonus":2000,"equipComment":"ㅎㅇ 싸인해줌?","equipCommentNoColon":true,"effect":"팔로워가 2,000명 증가합니다.\\n인플루언서 스킬과 중복 적용할 수 있습니다.\\n펫스킬을 해제하면 증가한 팔로워 2,000명은 회수됩니다.","sourceIndex":20,"sourceKey":"skill_020","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"셀럽","grade":"A","rate":1.5,"fixedRate":true,"followerBonus":2000,"equipComment":"ㅎㅇ 싸인해줌?","equipCommentNoColon":true,"effect":"팔로워가 2,000명 증가합니다.\\n인플루언서 스킬과 중복 적용할 수 있습니다.\\n펫스킬을 해제하면 증가한 팔로워 2,000명은 회수됩니다.","sourceIndex":20,"sourceKey":"skill_020","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_020', 'SKILL', '셀럽', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_020","sourceIndex":20,"sourceKey":"skill_020","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '셀럽'
FROM object_registry WHERE object_key = 'skill.pet_skill_020';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_020'
FROM object_registry WHERE object_key = 'skill.pet_skill_020';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_021', '사신의 낫', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"사신의 낫","grade":"A","rate":0.4,"fixedRate":true,"raidExp":500000,"castleExp":500000,"effect":"영혼마저 베어버린다는 사신의 거대한 낫입니다.\\n장착 시 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":21,"sourceKey":"skill_021","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"사신의 낫","grade":"A","rate":0.4,"fixedRate":true,"raidExp":500000,"castleExp":500000,"effect":"영혼마저 베어버린다는 사신의 거대한 낫입니다.\\n장착 시 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":21,"sourceKey":"skill_021","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_021', 'SKILL', '사신의 낫', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_021","sourceIndex":21,"sourceKey":"skill_021","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0.4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '사신의 낫'
FROM object_registry WHERE object_key = 'skill.pet_skill_021';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_021'
FROM object_registry WHERE object_key = 'skill.pet_skill_021';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_022', '아르카나 하우스', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"아르카나 하우스","grade":"A","rate":1.5,"fixedRate":true,"raidExp":500000,"castleExp":500000,"charmCondition":"arcanaFurniture","effect":"가구 [아르카나 루미에르]를 5개 이상 보유하면 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬 해제 또는 발동 조건 미충족 시 지급된 매력은 회수됩니다.","sourceIndex":22,"sourceKey":"skill_022","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"아르카나 하우스","grade":"A","rate":1.5,"fixedRate":true,"raidExp":500000,"castleExp":500000,"charmCondition":"arcanaFurniture","effect":"가구 [아르카나 루미에르]를 5개 이상 보유하면 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬 해제 또는 발동 조건 미충족 시 지급된 매력은 회수됩니다.","sourceIndex":22,"sourceKey":"skill_022","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_022', 'SKILL', '아르카나 하우스', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_022","sourceIndex":22,"sourceKey":"skill_022","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '아르카나 하우스'
FROM object_registry WHERE object_key = 'skill.pet_skill_022';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_022'
FROM object_registry WHERE object_key = 'skill.pet_skill_022';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_023', '쇼핑광', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"쇼핑광","grade":"A","rate":1.7,"effect":"상점 20% 할인","sourceIndex":23,"sourceKey":"skill_023","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"쇼핑광","grade":"A","rate":1.7,"effect":"상점 20% 할인","sourceIndex":23,"sourceKey":"skill_023","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_023', 'SKILL', '쇼핑광', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_023","sourceIndex":23,"sourceKey":"skill_023","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '쇼핑광'
FROM object_registry WHERE object_key = 'skill.pet_skill_023';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_023'
FROM object_registry WHERE object_key = 'skill.pet_skill_023';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_024', '티어 상승론', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"티어 상승론","grade":"A","rate":1.7,"effect":"/상점에서 티어 승급티켓🎟 구매 시 구매 수량의 1%를 추가로 획득합니다.","sourceIndex":24,"sourceKey":"skill_024","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"티어 상승론","grade":"A","rate":1.7,"effect":"/상점에서 티어 승급티켓🎟 구매 시 구매 수량의 1%를 추가로 획득합니다.","sourceIndex":24,"sourceKey":"skill_024","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_024', 'SKILL', '티어 상승론', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_024","sourceIndex":24,"sourceKey":"skill_024","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '티어 상승론'
FROM object_registry WHERE object_key = 'skill.pet_skill_024';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_024'
FROM object_registry WHERE object_key = 'skill.pet_skill_024';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_025', '징집명령', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"징집명령","grade":"A","rate":1.7,"effect":"길드마스터 전용 스킬입니다.\\n길드에 가입할 수 있는 최대 인원이 1명 증가합니다.","sourceIndex":25,"sourceKey":"skill_025","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"징집명령","grade":"A","rate":1.7,"effect":"길드마스터 전용 스킬입니다.\\n길드에 가입할 수 있는 최대 인원이 1명 증가합니다.","sourceIndex":25,"sourceKey":"skill_025","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_025', 'SKILL', '징집명령', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_025","sourceIndex":25,"sourceKey":"skill_025","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '징집명령'
FROM object_registry WHERE object_key = 'skill.pet_skill_025';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_025'
FROM object_registry WHERE object_key = 'skill.pet_skill_025';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_026', '보물 사냥꾼', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"보물 사냥꾼","grade":"A","rate":1.7,"effect":"/펫탐험 성공 시 15% 확률로 탐험보상 1개를 추가 획득합니다.\\n※최초 적용시 /탐 [숫자]를 입력해야 적용됩니다.","sourceIndex":26,"sourceKey":"skill_026","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"보물 사냥꾼","grade":"A","rate":1.7,"effect":"/펫탐험 성공 시 15% 확률로 탐험보상 1개를 추가 획득합니다.\\n※최초 적용시 /탐 [숫자]를 입력해야 적용됩니다.","sourceIndex":26,"sourceKey":"skill_026","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_026', 'SKILL', '보물 사냥꾼', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_026","sourceIndex":26,"sourceKey":"skill_026","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '보물 사냥꾼'
FROM object_registry WHERE object_key = 'skill.pet_skill_026';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_026'
FROM object_registry WHERE object_key = 'skill.pet_skill_026';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_027', '도굴꾼', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"도굴꾼","grade":"A","rate":1.7,"effect":"펫탐험 보물지도🗺️ 아이템이 소모되지 않고 효과가 적용됩니다.\\n※최초 적용시 /탐 [숫자]를 입력해야 적용됩니다.","sourceIndex":27,"sourceKey":"skill_027","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"도굴꾼","grade":"A","rate":1.7,"effect":"펫탐험 보물지도🗺️ 아이템이 소모되지 않고 효과가 적용됩니다.\\n※최초 적용시 /탐 [숫자]를 입력해야 적용됩니다.","sourceIndex":27,"sourceKey":"skill_027","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_027', 'SKILL', '도굴꾼', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_027","sourceIndex":27,"sourceKey":"skill_027","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '도굴꾼'
FROM object_registry WHERE object_key = 'skill.pet_skill_027';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_027'
FROM object_registry WHERE object_key = 'skill.pet_skill_027';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('SKILL-PET-BALD-BLACKSMITH', '대머리 대장장이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"대머리 대장장이","grade":"A","rate":1.7,"effect":"/펫강화 성공 확률 5% 증가","sourceIndex":28,"sourceKey":"skill_028","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"대머리 대장장이","grade":"A","rate":1.7,"effect":"/펫강화 성공 확률 5% 증가","sourceIndex":28,"sourceKey":"skill_028","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_028', 'SKILL', '대머리 대장장이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"SKILL-PET-BALD-BLACKSMITH","sourceIndex":28,"sourceKey":"skill_028","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '대머리 대장장이'
FROM object_registry WHERE object_key = 'skill.pet_skill_028';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_028'
FROM object_registry WHERE object_key = 'skill.pet_skill_028';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('SKILL-FLOWER-SHOP-BLACKSMITH', '꽃집 대장장이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"꽃집 대장장이","grade":"A","rate":1.7,"effect":"/정령강화 성공 확률 5% 증가","sourceIndex":29,"sourceKey":"skill_029","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"꽃집 대장장이","grade":"A","rate":1.7,"effect":"/정령강화 성공 확률 5% 증가","sourceIndex":29,"sourceKey":"skill_029","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_029', 'SKILL', '꽃집 대장장이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"SKILL-FLOWER-SHOP-BLACKSMITH","sourceIndex":29,"sourceKey":"skill_029","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":1.7,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '꽃집 대장장이'
FROM object_registry WHERE object_key = 'skill.pet_skill_029';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_029'
FROM object_registry WHERE object_key = 'skill.pet_skill_029';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_030', '일일루틴', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"일일루틴","grade":"B","rate":2,"effect":"일일퀘스트 완료 시 100%로 포인트 1억을 획득합니다.","sourceIndex":30,"sourceKey":"skill_030","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"일일루틴","grade":"B","rate":2,"effect":"일일퀘스트 완료 시 100%로 포인트 1억을 획득합니다.","sourceIndex":30,"sourceKey":"skill_030","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_030', 'SKILL', '일일루틴', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_030","sourceIndex":30,"sourceKey":"skill_030","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '일일루틴'
FROM object_registry WHERE object_key = 'skill.pet_skill_030';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_030'
FROM object_registry WHERE object_key = 'skill.pet_skill_030';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_031', '주간루틴', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"주간루틴","grade":"B","rate":2,"effect":"주간퀘스트 완료 시 100%로 포인트 10억을 획득합니다.","sourceIndex":31,"sourceKey":"skill_031","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"주간루틴","grade":"B","rate":2,"effect":"주간퀘스트 완료 시 100%로 포인트 10억을 획득합니다.","sourceIndex":31,"sourceKey":"skill_031","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_031', 'SKILL', '주간루틴', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_031","sourceIndex":31,"sourceKey":"skill_031","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '주간루틴'
FROM object_registry WHERE object_key = 'skill.pet_skill_031';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_031'
FROM object_registry WHERE object_key = 'skill.pet_skill_031';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('trial_walker', '시련을 걷는 자', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"시련을 걷는 자","grade":"B","rate":2,"effect":"10% 확률로 시련의 탑 공략 성공","sourceIndex":32,"sourceKey":"skill_032","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"시련을 걷는 자","grade":"B","rate":2,"effect":"10% 확률로 시련의 탑 공략 성공","sourceIndex":32,"sourceKey":"skill_032","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_032', 'SKILL', '시련을 걷는 자', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"trial_walker","sourceIndex":32,"sourceKey":"skill_032","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '시련을 걷는 자'
FROM object_registry WHERE object_key = 'skill.pet_skill_032';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_032'
FROM object_registry WHERE object_key = 'skill.pet_skill_032';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_033', '결혼못한 대장장이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"결혼못한 대장장이","grade":"B","rate":2,"effect":"/펜던트강화 성공 확률 1% 증가","sourceIndex":33,"sourceKey":"skill_033","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"결혼못한 대장장이","grade":"B","rate":2,"effect":"/펜던트강화 성공 확률 1% 증가","sourceIndex":33,"sourceKey":"skill_033","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_033', 'SKILL', '결혼못한 대장장이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_033","sourceIndex":33,"sourceKey":"skill_033","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '결혼못한 대장장이'
FROM object_registry WHERE object_key = 'skill.pet_skill_033';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_033'
FROM object_registry WHERE object_key = 'skill.pet_skill_033';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_salvation', '구원', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"구원","grade":"B","rate":2.3,"effect":"시련의탑 50% 확률로 순간 매력 50만 지원","sourceIndex":34,"sourceKey":"skill_034","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"구원","grade":"B","rate":2.3,"effect":"시련의탑 50% 확률로 순간 매력 50만 지원","sourceIndex":34,"sourceKey":"skill_034","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_034', 'SKILL', '구원', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_salvation","sourceIndex":34,"sourceKey":"skill_034","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2.3,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '구원'
FROM object_registry WHERE object_key = 'skill.pet_skill_034';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_034'
FROM object_registry WHERE object_key = 'skill.pet_skill_034';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_035', '나 혼자만 레벨업', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"나 혼자만 레벨업","grade":"B","rate":2.3,"effect":"레벨업 시 3업당 매력 +10","sourceIndex":35,"sourceKey":"skill_035","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"나 혼자만 레벨업","grade":"B","rate":2.3,"effect":"레벨업 시 3업당 매력 +10","sourceIndex":35,"sourceKey":"skill_035","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_035', 'SKILL', '나 혼자만 레벨업', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_035","sourceIndex":35,"sourceKey":"skill_035","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2.3,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '나 혼자만 레벨업'
FROM object_registry WHERE object_key = 'skill.pet_skill_035';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_035'
FROM object_registry WHERE object_key = 'skill.pet_skill_035';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_hunter', '헌터', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"헌터","grade":"B","rate":2.4,"effect":"/미니펫대전 시 7% 확률로 미니펫뽑기 1개 획득","sourceIndex":36,"sourceKey":"skill_036","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"헌터","grade":"B","rate":2.4,"effect":"/미니펫대전 시 7% 확률로 미니펫뽑기 1개 획득","sourceIndex":36,"sourceKey":"skill_036","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_036', 'SKILL', '헌터', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_hunter","sourceIndex":36,"sourceKey":"skill_036","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2.4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '헌터'
FROM object_registry WHERE object_key = 'skill.pet_skill_036';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_036'
FROM object_registry WHERE object_key = 'skill.pet_skill_036';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_037', '광산탐험가', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"광산탐험가","grade":"B","rate":2.5,"effect":"펫강화/친밀도/행운 탐험 성공확률 5% 상승","sourceIndex":37,"sourceKey":"skill_037","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"광산탐험가","grade":"B","rate":2.5,"effect":"펫강화/친밀도/행운 탐험 성공확률 5% 상승","sourceIndex":37,"sourceKey":"skill_037","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_037', 'SKILL', '광산탐험가', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_037","sourceIndex":37,"sourceKey":"skill_037","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '광산탐험가'
FROM object_registry WHERE object_key = 'skill.pet_skill_037';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_037'
FROM object_registry WHERE object_key = 'skill.pet_skill_037';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_038', '던전탐험가', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"던전탐험가","grade":"B","rate":2.5,"effect":"전도르/양계장/땅문서/샵오픈 탐험 성공확률 5% 상승","sourceIndex":38,"sourceKey":"skill_038","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"던전탐험가","grade":"B","rate":2.5,"effect":"전도르/양계장/땅문서/샵오픈 탐험 성공확률 5% 상승","sourceIndex":38,"sourceKey":"skill_038","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_038', 'SKILL', '던전탐험가', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_038","sourceIndex":38,"sourceKey":"skill_038","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '던전탐험가'
FROM object_registry WHERE object_key = 'skill.pet_skill_038';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_038'
FROM object_registry WHERE object_key = 'skill.pet_skill_038';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_039', '인플루언서', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"인플루언서","grade":"B","rate":2,"fixedRate":true,"followerBonus":1000,"equipComment":"여러분 안녕 이건 뒷광고 ㄴㄴ 내돈내산이야루~","equipCommentNoColon":true,"effect":"팔로워가 1,000명 증가합니다.\\n셀럽 스킬과 중복 적용할 수 있습니다.\\n펫스킬을 해제하면 증가한 팔로워 1,000명은 회수됩니다.","sourceIndex":39,"sourceKey":"skill_039","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"인플루언서","grade":"B","rate":2,"fixedRate":true,"followerBonus":1000,"equipComment":"여러분 안녕 이건 뒷광고 ㄴㄴ 내돈내산이야루~","equipCommentNoColon":true,"effect":"팔로워가 1,000명 증가합니다.\\n셀럽 스킬과 중복 적용할 수 있습니다.\\n펫스킬을 해제하면 증가한 팔로워 1,000명은 회수됩니다.","sourceIndex":39,"sourceKey":"skill_039","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_039', 'SKILL', '인플루언서', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_039","sourceIndex":39,"sourceKey":"skill_039","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":2,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '인플루언서'
FROM object_registry WHERE object_key = 'skill.pet_skill_039';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_039'
FROM object_registry WHERE object_key = 'skill.pet_skill_039';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_040', '큐피드의 활', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"큐피드의 활","grade":"B","rate":1.5,"fixedRate":true,"raidExp":250000,"castleExp":250000,"effect":"상대의 마음을 단번에 사로잡는 사랑의 활입니다.\\n장착 시 레이드매력 25만과 캐슬매력 25만, 총 종합매력 50만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":40,"sourceKey":"skill_040","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"큐피드의 활","grade":"B","rate":1.5,"fixedRate":true,"raidExp":250000,"castleExp":250000,"effect":"상대의 마음을 단번에 사로잡는 사랑의 활입니다.\\n장착 시 레이드매력 25만과 캐슬매력 25만, 총 종합매력 50만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":40,"sourceKey":"skill_040","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_040', 'SKILL', '큐피드의 활', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_040","sourceIndex":40,"sourceKey":"skill_040","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":1.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '큐피드의 활'
FROM object_registry WHERE object_key = 'skill.pet_skill_040';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_040'
FROM object_registry WHERE object_key = 'skill.pet_skill_040';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('SKILL-ROLEX', '롤렉스', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"롤렉스","grade":"C","rate":4,"effect":"손목에 차고 있으면 괜히 기분이 좋아지고, 손을 들어 자랑하고 싶은 욕구가 생깁니다.\\n명령어: /자랑","sourceIndex":41,"sourceKey":"skill_041","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"롤렉스","grade":"C","rate":4,"effect":"손목에 차고 있으면 괜히 기분이 좋아지고, 손을 들어 자랑하고 싶은 욕구가 생깁니다.\\n명령어: /자랑","sourceIndex":41,"sourceKey":"skill_041","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_041', 'SKILL', '롤렉스', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"SKILL-ROLEX","sourceIndex":41,"sourceKey":"skill_041","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '롤렉스'
FROM object_registry WHERE object_key = 'skill.pet_skill_041';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_041'
FROM object_registry WHERE object_key = 'skill.pet_skill_041';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_building_owner', '건물주', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"건물주","grade":"C","rate":4.4,"effect":"/펫홈에 장착할 수 있는 가구를 10개 늘려줍니다.","sourceIndex":42,"sourceKey":"skill_042","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"건물주","grade":"C","rate":4.4,"effect":"/펫홈에 장착할 수 있는 가구를 10개 늘려줍니다.","sourceIndex":42,"sourceKey":"skill_042","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_042', 'SKILL', '건물주', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_building_owner","sourceIndex":42,"sourceKey":"skill_042","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4.4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '건물주'
FROM object_registry WHERE object_key = 'skill.pet_skill_042';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_042'
FROM object_registry WHERE object_key = 'skill.pet_skill_042';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_043', '악덕한 영주', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"악덕한 영주","grade":"C","rate":4,"effect":"호랜캐슬 세금 30% 강제 고정","sourceIndex":43,"sourceKey":"skill_043","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"악덕한 영주","grade":"C","rate":4,"effect":"호랜캐슬 세금 30% 강제 고정","sourceIndex":43,"sourceKey":"skill_043","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_043', 'SKILL', '악덕한 영주', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_043","sourceIndex":43,"sourceKey":"skill_043","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '악덕한 영주'
FROM object_registry WHERE object_key = 'skill.pet_skill_043';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_043'
FROM object_registry WHERE object_key = 'skill.pet_skill_043';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_044', '오픈런', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"오픈런","grade":"C","rate":4,"effect":"명령어: ㅊㅊ 1등시 펫먹이🍼1,000개를 획득합니다.\\n출석목록 기준 1등","sourceIndex":44,"sourceKey":"skill_044","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"오픈런","grade":"C","rate":4,"effect":"명령어: ㅊㅊ 1등시 펫먹이🍼1,000개를 획득합니다.\\n출석목록 기준 1등","sourceIndex":44,"sourceKey":"skill_044","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_044', 'SKILL', '오픈런', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_044","sourceIndex":44,"sourceKey":"skill_044","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '오픈런'
FROM object_registry WHERE object_key = 'skill.pet_skill_044';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_044'
FROM object_registry WHERE object_key = 'skill.pet_skill_044';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_045', '야수의 본능', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"야수의 본능","grade":"C","rate":4,"effect":"미니펫대전시 30% 확률로 포인트를 2배 획득합니다.(600만포)","sourceIndex":45,"sourceKey":"skill_045","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"야수의 본능","grade":"C","rate":4,"effect":"미니펫대전시 30% 확률로 포인트를 2배 획득합니다.(600만포)","sourceIndex":45,"sourceKey":"skill_045","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_045', 'SKILL', '야수의 본능', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_045","sourceIndex":45,"sourceKey":"skill_045","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '야수의 본능'
FROM object_registry WHERE object_key = 'skill.pet_skill_045';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_045'
FROM object_registry WHERE object_key = 'skill.pet_skill_045';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('trial_worshipper', '탑 숭배자', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"탑 숭배자","grade":"C","rate":4.3,"effect":"/시련의탑 시 10% 확률로 매력 +2 획득","sourceIndex":46,"sourceKey":"skill_046","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"탑 숭배자","grade":"C","rate":4.3,"effect":"/시련의탑 시 10% 확률로 매력 +2 획득","sourceIndex":46,"sourceKey":"skill_046","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_046', 'SKILL', '탑 숭배자', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"trial_worshipper","sourceIndex":46,"sourceKey":"skill_046","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4.3,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '탑 숭배자'
FROM object_registry WHERE object_key = 'skill.pet_skill_046';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_046'
FROM object_registry WHERE object_key = 'skill.pet_skill_046';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('SKILL-PRAYER', '기도', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"기도","grade":"C","rate":4.5,"effect":"하루 한번 호월신에게 기도를 올립니다 3% 확률로 호월신이 응답하면 주간상자🌼 1개를 획득합니다.","sourceIndex":47,"sourceKey":"skill_047","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"기도","grade":"C","rate":4.5,"effect":"하루 한번 호월신에게 기도를 올립니다 3% 확률로 호월신이 응답하면 주간상자🌼 1개를 획득합니다.","sourceIndex":47,"sourceKey":"skill_047","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_047', 'SKILL', '기도', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"SKILL-PRAYER","sourceIndex":47,"sourceKey":"skill_047","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '기도'
FROM object_registry WHERE object_key = 'skill.pet_skill_047';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_047'
FROM object_registry WHERE object_key = 'skill.pet_skill_047';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_048', '플러팅', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"플러팅","grade":"C","rate":4.5,"effect":"@멘션 호출 시 멘트 출력","sourceIndex":48,"sourceKey":"skill_048","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"플러팅","grade":"C","rate":4.5,"effect":"@멘션 호출 시 멘트 출력","sourceIndex":48,"sourceKey":"skill_048","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_048', 'SKILL', '플러팅', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_048","sourceIndex":48,"sourceKey":"skill_048","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '플러팅'
FROM object_registry WHERE object_key = 'skill.pet_skill_048';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_048'
FROM object_registry WHERE object_key = 'skill.pet_skill_048';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_049', '펫스킬 학개론', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"펫스킬 학개론","grade":"C","rate":4.5,"effect":"장착 가능한 펫스킬 공간이 3칸 확장됩니다.\\n최대수치 30개가 되면 33개로 확장됩니다.","sourceIndex":49,"sourceKey":"skill_049","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"펫스킬 학개론","grade":"C","rate":4.5,"effect":"장착 가능한 펫스킬 공간이 3칸 확장됩니다.\\n최대수치 30개가 되면 33개로 확장됩니다.","sourceIndex":49,"sourceKey":"skill_049","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_049', 'SKILL', '펫스킬 학개론', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_049","sourceIndex":49,"sourceKey":"skill_049","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '펫스킬 학개론'
FROM object_registry WHERE object_key = 'skill.pet_skill_049';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_049'
FROM object_registry WHERE object_key = 'skill.pet_skill_049';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_050', '초월성장', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"초월성장","grade":"C","rate":4.5,"effect":"레벨업시 펫먹이🍼 10개 획득합니다.","sourceIndex":50,"sourceKey":"skill_050","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"초월성장","grade":"C","rate":4.5,"effect":"레벨업시 펫먹이🍼 10개 획득합니다.","sourceIndex":50,"sourceKey":"skill_050","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_050', 'SKILL', '초월성장', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_050","sourceIndex":50,"sourceKey":"skill_050","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '초월성장'
FROM object_registry WHERE object_key = 'skill.pet_skill_050';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_050'
FROM object_registry WHERE object_key = 'skill.pet_skill_050';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_051', '망므', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"망므","grade":"C","rate":4,"heartBonus":5,"equipComment":"이건 내 망므야!","equipCommentNoColon":true,"effect":"하루 마음 보내기 가능 횟수가 5회 증가합니다.\\n펫스킬을 해제하면 추가된 일일 한도 5회는 회수됩니다.","sourceIndex":51,"sourceKey":"skill_051","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"망므","grade":"C","rate":4,"heartBonus":5,"equipComment":"이건 내 망므야!","equipCommentNoColon":true,"effect":"하루 마음 보내기 가능 횟수가 5회 증가합니다.\\n펫스킬을 해제하면 추가된 일일 한도 5회는 회수됩니다.","sourceIndex":51,"sourceKey":"skill_051","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_051', 'SKILL', '망므', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_051","sourceIndex":51,"sourceKey":"skill_051","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '망므'
FROM object_registry WHERE object_key = 'skill.pet_skill_051';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_051'
FROM object_registry WHERE object_key = 'skill.pet_skill_051';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_052', '도깨비 방망이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"도깨비 방망이","grade":"C","rate":4,"raidExp":100000,"castleExp":100000,"effect":"휘두를 때마다 신비한 힘이 솟아나는 도깨비의 방망이입니다.\\n장착 시 레이드매력 10만과 캐슬매력 10만, 총 종합매력 20만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":52,"sourceKey":"skill_052","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"도깨비 방망이","grade":"C","rate":4,"raidExp":100000,"castleExp":100000,"effect":"휘두를 때마다 신비한 힘이 솟아나는 도깨비의 방망이입니다.\\n장착 시 레이드매력 10만과 캐슬매력 10만, 총 종합매력 20만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":52,"sourceKey":"skill_052","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_052', 'SKILL', '도깨비 방망이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_052","sourceIndex":52,"sourceKey":"skill_052","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":4,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '도깨비 방망이'
FROM object_registry WHERE object_key = 'skill.pet_skill_052';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_052'
FROM object_registry WHERE object_key = 'skill.pet_skill_052';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_053', '정신승리', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"정신승리","grade":"C","rate":5,"effect":"캐슬대전,미니펫대전 패배 시 정신승리를 합니다.","sourceIndex":53,"sourceKey":"skill_053","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"정신승리","grade":"C","rate":5,"effect":"캐슬대전,미니펫대전 패배 시 정신승리를 합니다.","sourceIndex":53,"sourceKey":"skill_053","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_053', 'SKILL', '정신승리', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_053","sourceIndex":53,"sourceKey":"skill_053","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '정신승리'
FROM object_registry WHERE object_key = 'skill.pet_skill_053';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_053'
FROM object_registry WHERE object_key = 'skill.pet_skill_053';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_054', '기분탓', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"기분탓","grade":"D","rate":14.5,"effect":"''?'' 채팅 입력 시 연출 멘트를 출력합니다.","sourceIndex":54,"sourceKey":"skill_054","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"기분탓","grade":"D","rate":14.5,"effect":"''?'' 채팅 입력 시 연출 멘트를 출력합니다.","sourceIndex":54,"sourceKey":"skill_054","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_054', 'SKILL', '기분탓', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_054","sourceIndex":54,"sourceKey":"skill_054","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"D","rate":14.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '기분탓'
FROM object_registry WHERE object_key = 'skill.pet_skill_054';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_054'
FROM object_registry WHERE object_key = 'skill.pet_skill_054';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_055', '종의 본능', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"종의 본능","grade":"D","rate":14.5,"effect":"''이쁘다'' 채팅 입력 시 연출 멘트를 출력합니다.","sourceIndex":55,"sourceKey":"skill_055","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"종의 본능","grade":"D","rate":14.5,"effect":"''이쁘다'' 채팅 입력 시 연출 멘트를 출력합니다.","sourceIndex":55,"sourceKey":"skill_055","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_055', 'SKILL', '종의 본능', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_055","sourceIndex":55,"sourceKey":"skill_055","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"D","rate":14.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '종의 본능'
FROM object_registry WHERE object_key = 'skill.pet_skill_055';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_055'
FROM object_registry WHERE object_key = 'skill.pet_skill_055';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_056', '품행제로', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"품행제로","grade":"D","rate":14.5,"effect":"/결투 [아이디] 입력 시 70% 확률로 상대를 이기는 연출 멘트를 출력합니다. 실제 승패 수치 변화는 없습니다.","sourceIndex":56,"sourceKey":"skill_056","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"품행제로","grade":"D","rate":14.5,"effect":"/결투 [아이디] 입력 시 70% 확률로 상대를 이기는 연출 멘트를 출력합니다. 실제 승패 수치 변화는 없습니다.","sourceIndex":56,"sourceKey":"skill_056","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_056', 'SKILL', '품행제로', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_056","sourceIndex":56,"sourceKey":"skill_056","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"D","rate":14.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '품행제로'
FROM object_registry WHERE object_key = 'skill.pet_skill_056';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_056'
FROM object_registry WHERE object_key = 'skill.pet_skill_056';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_057', '망한건 맞아', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"망한건 맞아","grade":"D","rate":14.5,"effect":"/펫스킬오픈으로 획득할 수 있으며, 장착 시 기분만 묘하게 나빠집니다. 아무 효과가 없습니다.","sourceIndex":57,"sourceKey":"skill_057","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"망한건 맞아","grade":"D","rate":14.5,"effect":"/펫스킬오픈으로 획득할 수 있으며, 장착 시 기분만 묘하게 나빠집니다. 아무 효과가 없습니다.","sourceIndex":57,"sourceKey":"skill_057","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_057', 'SKILL', '망한건 맞아', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_057","sourceIndex":57,"sourceKey":"skill_057","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"D","rate":14.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '망한건 맞아'
FROM object_registry WHERE object_key = 'skill.pet_skill_057';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_057'
FROM object_registry WHERE object_key = 'skill.pet_skill_057';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_058', '무소유', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"무소유","grade":"D","rate":14.5,"effect":"땅에서 태어나 땅으로 흘러들어가니 그것이 인생이느니라","sourceIndex":58,"sourceKey":"skill_058","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"무소유","grade":"D","rate":14.5,"effect":"땅에서 태어나 땅으로 흘러들어가니 그것이 인생이느니라","sourceIndex":58,"sourceKey":"skill_058","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_058', 'SKILL', '무소유', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_058","sourceIndex":58,"sourceKey":"skill_058","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"D","rate":14.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '무소유'
FROM object_registry WHERE object_key = 'skill.pet_skill_058';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_058'
FROM object_registry WHERE object_key = 'skill.pet_skill_058';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_059', '낡은 목검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"낡은 목검","grade":"D","rate":14.5,"raidExp":50000,"castleExp":50000,"effect":"오랜 세월 수련에 사용된 낡은 목검입니다.\\n장착 시 레이드매력 5만과 캐슬매력 5만, 총 종합매력 10만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":59,"sourceKey":"skill_059","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"낡은 목검","grade":"D","rate":14.5,"raidExp":50000,"castleExp":50000,"effect":"오랜 세월 수련에 사용된 낡은 목검입니다.\\n장착 시 레이드매력 5만과 캐슬매력 5만, 총 종합매력 10만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.","sourceIndex":59,"sourceKey":"skill_059","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_059', 'SKILL', '낡은 목검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_059","sourceIndex":59,"sourceKey":"skill_059","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"D","rate":14.5,"tierExclusive":false}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '낡은 목검'
FROM object_registry WHERE object_key = 'skill.pet_skill_059';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_059'
FROM object_registry WHERE object_key = 'skill.pet_skill_059';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_060', '🪽 엠퍼러의 천공 날개', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🪽 엠퍼러의 천공 날개","grade":"C","rate":0,"requiredTier":"엠퍼러","raidExp":100000,"castleExp":100000,"equipComment":"잠깐, 나 지금 날고 있는 거야?!","tierExclusive":true,"effect":"엠퍼러 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 10만 증가합니다.","sourceIndex":60,"sourceKey":"skill_060","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🪽 엠퍼러의 천공 날개","grade":"C","rate":0,"requiredTier":"엠퍼러","raidExp":100000,"castleExp":100000,"equipComment":"잠깐, 나 지금 날고 있는 거야?!","tierExclusive":true,"effect":"엠퍼러 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 10만 증가합니다.","sourceIndex":60,"sourceKey":"skill_060","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_060', 'SKILL', '🪽 엠퍼러의 천공 날개', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_060","sourceIndex":60,"sourceKey":"skill_060","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🪽 엠퍼러의 천공 날개'
FROM object_registry WHERE object_key = 'skill.pet_skill_060';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_060'
FROM object_registry WHERE object_key = 'skill.pet_skill_060';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_061', '🪬 올마이티의 전능 부적', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🪬 올마이티의 전능 부적","grade":"C","rate":0,"requiredTier":"올마이티","raidExp":150000,"castleExp":150000,"equipComment":"뭐든 할 수 있을 것 같은 기분이야!","tierExclusive":true,"effect":"올마이티 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 15만 증가합니다.","sourceIndex":61,"sourceKey":"skill_061","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🪬 올마이티의 전능 부적","grade":"C","rate":0,"requiredTier":"올마이티","raidExp":150000,"castleExp":150000,"equipComment":"뭐든 할 수 있을 것 같은 기분이야!","tierExclusive":true,"effect":"올마이티 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 15만 증가합니다.","sourceIndex":61,"sourceKey":"skill_061","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_061', 'SKILL', '🪬 올마이티의 전능 부적', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_061","sourceIndex":61,"sourceKey":"skill_061","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🪬 올마이티의 전능 부적'
FROM object_registry WHERE object_key = 'skill.pet_skill_061';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_061'
FROM object_registry WHERE object_key = 'skill.pet_skill_061';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_062', '🤍 하얀하트의 순백 반지', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🤍 하얀하트의 순백 반지","grade":"C","rate":0,"requiredTier":"하얀하트","raidExp":200000,"castleExp":200000,"equipComment":"깨끗하게, 맑게, 자신 있게!","tierExclusive":true,"effect":"하얀하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 20만 증가합니다.","sourceIndex":62,"sourceKey":"skill_062","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🤍 하얀하트의 순백 반지","grade":"C","rate":0,"requiredTier":"하얀하트","raidExp":200000,"castleExp":200000,"equipComment":"깨끗하게, 맑게, 자신 있게!","tierExclusive":true,"effect":"하얀하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 20만 증가합니다.","sourceIndex":62,"sourceKey":"skill_062","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_062', 'SKILL', '🤍 하얀하트의 순백 반지', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_062","sourceIndex":62,"sourceKey":"skill_062","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🤍 하얀하트의 순백 반지'
FROM object_registry WHERE object_key = 'skill.pet_skill_062';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_062'
FROM object_registry WHERE object_key = 'skill.pet_skill_062';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_063', '🩵 하늘하트의 창공 목걸이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🩵 하늘하트의 창공 목걸이","grade":"C","rate":0,"requiredTier":"하늘하트","raidExp":300000,"castleExp":300000,"equipComment":"오늘 하늘은 내가 접수한다!","tierExclusive":true,"effect":"하늘하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 30만 증가합니다.","sourceIndex":63,"sourceKey":"skill_063","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🩵 하늘하트의 창공 목걸이","grade":"C","rate":0,"requiredTier":"하늘하트","raidExp":300000,"castleExp":300000,"equipComment":"오늘 하늘은 내가 접수한다!","tierExclusive":true,"effect":"하늘하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 30만 증가합니다.","sourceIndex":63,"sourceKey":"skill_063","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_063', 'SKILL', '🩵 하늘하트의 창공 목걸이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_063","sourceIndex":63,"sourceKey":"skill_063","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🩵 하늘하트의 창공 목걸이'
FROM object_registry WHERE object_key = 'skill.pet_skill_063';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_063'
FROM object_registry WHERE object_key = 'skill.pet_skill_063';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_064', '💛 노랑하트의 황금 팔찌', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💛 노랑하트의 황금 팔찌","grade":"C","rate":0,"requiredTier":"노랑하트","raidExp":400000,"castleExp":400000,"equipComment":"번쩍번쩍! 부자 된 기분이야!","tierExclusive":true,"effect":"노랑하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 40만 증가합니다.","sourceIndex":64,"sourceKey":"skill_064","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💛 노랑하트의 황금 팔찌","grade":"C","rate":0,"requiredTier":"노랑하트","raidExp":400000,"castleExp":400000,"equipComment":"번쩍번쩍! 부자 된 기분이야!","tierExclusive":true,"effect":"노랑하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 40만 증가합니다.","sourceIndex":64,"sourceKey":"skill_064","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_064', 'SKILL', '💛 노랑하트의 황금 팔찌', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_064","sourceIndex":64,"sourceKey":"skill_064","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '💛 노랑하트의 황금 팔찌'
FROM object_registry WHERE object_key = 'skill.pet_skill_064';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_064'
FROM object_registry WHERE object_key = 'skill.pet_skill_064';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_065', '💜 보라하트의 환상 보주', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💜 보라하트의 환상 보주","grade":"C","rate":0,"requiredTier":"보라하트","raidExp":500000,"castleExp":500000,"equipComment":"어라? 방금 유니콘 지나갔어!","tierExclusive":true,"effect":"보라하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 50만 증가합니다.","sourceIndex":65,"sourceKey":"skill_065","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💜 보라하트의 환상 보주","grade":"C","rate":0,"requiredTier":"보라하트","raidExp":500000,"castleExp":500000,"equipComment":"어라? 방금 유니콘 지나갔어!","tierExclusive":true,"effect":"보라하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 50만 증가합니다.","sourceIndex":65,"sourceKey":"skill_065","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_065', 'SKILL', '💜 보라하트의 환상 보주', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_065","sourceIndex":65,"sourceKey":"skill_065","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '💜 보라하트의 환상 보주'
FROM object_registry WHERE object_key = 'skill.pet_skill_065';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_065'
FROM object_registry WHERE object_key = 'skill.pet_skill_065';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_066', '❤️ 빨강하트의 맹세검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"❤️ 빨강하트의 맹세검","grade":"C","rate":0,"requiredTier":"빨강하트","raidExp":650000,"castleExp":650000,"equipComment":"내 뜨거운 마음을 받아랏!","tierExclusive":true,"effect":"빨강하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 65만 증가합니다.","sourceIndex":66,"sourceKey":"skill_066","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"❤️ 빨강하트의 맹세검","grade":"C","rate":0,"requiredTier":"빨강하트","raidExp":650000,"castleExp":650000,"equipComment":"내 뜨거운 마음을 받아랏!","tierExclusive":true,"effect":"빨강하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 65만 증가합니다.","sourceIndex":66,"sourceKey":"skill_066","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_066', 'SKILL', '❤️ 빨강하트의 맹세검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_066","sourceIndex":66,"sourceKey":"skill_066","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '❤️ 빨강하트의 맹세검'
FROM object_registry WHERE object_key = 'skill.pet_skill_066';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_066'
FROM object_registry WHERE object_key = 'skill.pet_skill_066';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_067', '🖤 블랙하트의 칠흑 대낫', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🖤 블랙하트의 칠흑 대낫","grade":"C","rate":0,"requiredTier":"블랙하트","raidExp":800000,"castleExp":800000,"equipComment":"후후… 오늘부터 흑화한다!","tierExclusive":true,"effect":"블랙하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 80만 증가합니다.","sourceIndex":67,"sourceKey":"skill_067","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🖤 블랙하트의 칠흑 대낫","grade":"C","rate":0,"requiredTier":"블랙하트","raidExp":800000,"castleExp":800000,"equipComment":"후후… 오늘부터 흑화한다!","tierExclusive":true,"effect":"블랙하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 80만 증가합니다.","sourceIndex":67,"sourceKey":"skill_067","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_067', 'SKILL', '🖤 블랙하트의 칠흑 대낫', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_067","sourceIndex":67,"sourceKey":"skill_067","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"C","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🖤 블랙하트의 칠흑 대낫'
FROM object_registry WHERE object_key = 'skill.pet_skill_067';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_067'
FROM object_registry WHERE object_key = 'skill.pet_skill_067';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_068', '💖 반짝하트의 별빛 왕관', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💖 반짝하트의 별빛 왕관","grade":"B","rate":0,"requiredTier":"반짝하트","raidExp":1000000,"castleExp":1000000,"equipComment":"눈부시지? 내가 좀 빛나!","tierExclusive":true,"effect":"반짝하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 100만 증가합니다.","sourceIndex":68,"sourceKey":"skill_068","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💖 반짝하트의 별빛 왕관","grade":"B","rate":0,"requiredTier":"반짝하트","raidExp":1000000,"castleExp":1000000,"equipComment":"눈부시지? 내가 좀 빛나!","tierExclusive":true,"effect":"반짝하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 100만 증가합니다.","sourceIndex":68,"sourceKey":"skill_068","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_068', 'SKILL', '💖 반짝하트의 별빛 왕관', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_068","sourceIndex":68,"sourceKey":"skill_068","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '💖 반짝하트의 별빛 왕관'
FROM object_registry WHERE object_key = 'skill.pet_skill_068';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_068'
FROM object_registry WHERE object_key = 'skill.pet_skill_068';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_069', '❤️‍🔥 열정하트의 화염 건틀릿', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"❤️‍🔥 열정하트의 화염 건틀릿","grade":"B","rate":0,"requiredTier":"열정하트","raidExp":1250000,"castleExp":1250000,"equipComment":"주먹이 활활! 의욕도 활활!","tierExclusive":true,"effect":"열정하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 125만 증가합니다.","sourceIndex":69,"sourceKey":"skill_069","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"❤️‍🔥 열정하트의 화염 건틀릿","grade":"B","rate":0,"requiredTier":"열정하트","raidExp":1250000,"castleExp":1250000,"equipComment":"주먹이 활활! 의욕도 활활!","tierExclusive":true,"effect":"열정하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 125만 증가합니다.","sourceIndex":69,"sourceKey":"skill_069","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_069', 'SKILL', '❤️‍🔥 열정하트의 화염 건틀릿', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_069","sourceIndex":69,"sourceKey":"skill_069","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '❤️‍🔥 열정하트의 화염 건틀릿'
FROM object_registry WHERE object_key = 'skill.pet_skill_069';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_069'
FROM object_registry WHERE object_key = 'skill.pet_skill_069';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_070', '💘 화살하트의 운명 활', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💘 화살하트의 운명 활","grade":"B","rate":0,"requiredTier":"화살하트","raidExp":1500000,"castleExp":1500000,"equipComment":"빗나가도 사랑은 직진이야!","tierExclusive":true,"effect":"화살하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 150만 증가합니다.","sourceIndex":70,"sourceKey":"skill_070","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💘 화살하트의 운명 활","grade":"B","rate":0,"requiredTier":"화살하트","raidExp":1500000,"castleExp":1500000,"equipComment":"빗나가도 사랑은 직진이야!","tierExclusive":true,"effect":"화살하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 150만 증가합니다.","sourceIndex":70,"sourceKey":"skill_070","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_070', 'SKILL', '💘 화살하트의 운명 활', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_070","sourceIndex":70,"sourceKey":"skill_070","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '💘 화살하트의 운명 활'
FROM object_registry WHERE object_key = 'skill.pet_skill_070';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_070'
FROM object_registry WHERE object_key = 'skill.pet_skill_070';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_071', '💗 두근하트의 설렘 마법봉', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💗 두근하트의 설렘 마법봉","grade":"B","rate":0,"requiredTier":"두근하트","raidExp":1800000,"castleExp":1800000,"equipComment":"두근두근! 이거 고장 난 거 아니지?","tierExclusive":true,"effect":"두근하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 180만 증가합니다.","sourceIndex":71,"sourceKey":"skill_071","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💗 두근하트의 설렘 마법봉","grade":"B","rate":0,"requiredTier":"두근하트","raidExp":1800000,"castleExp":1800000,"equipComment":"두근두근! 이거 고장 난 거 아니지?","tierExclusive":true,"effect":"두근하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 180만 증가합니다.","sourceIndex":71,"sourceKey":"skill_071","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_071', 'SKILL', '💗 두근하트의 설렘 마법봉', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_071","sourceIndex":71,"sourceKey":"skill_071","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '💗 두근하트의 설렘 마법봉'
FROM object_registry WHERE object_key = 'skill.pet_skill_071';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_071'
FROM object_registry WHERE object_key = 'skill.pet_skill_071';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_072', '❤️‍🩹 심장하트의 수호 방패', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"❤️‍🩹 심장하트의 수호 방패","grade":"B","rate":0,"requiredTier":"심장하트","raidExp":2200000,"castleExp":2200000,"equipComment":"아픈 건 싫으니까 뒤에 숨을래!","tierExclusive":true,"effect":"심장하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 220만 증가합니다.","sourceIndex":72,"sourceKey":"skill_072","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"❤️‍🩹 심장하트의 수호 방패","grade":"B","rate":0,"requiredTier":"심장하트","raidExp":2200000,"castleExp":2200000,"equipComment":"아픈 건 싫으니까 뒤에 숨을래!","tierExclusive":true,"effect":"심장하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 220만 증가합니다.","sourceIndex":72,"sourceKey":"skill_072","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_072', 'SKILL', '❤️‍🩹 심장하트의 수호 방패', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_072","sourceIndex":72,"sourceKey":"skill_072","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '❤️‍🩹 심장하트의 수호 방패'
FROM object_registry WHERE object_key = 'skill.pet_skill_072';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_072'
FROM object_registry WHERE object_key = 'skill.pet_skill_072';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_073', '💟 보라보라하트의 자수정 귀걸이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💟 보라보라하트의 자수정 귀걸이","grade":"B","rate":0,"requiredTier":"보라보라하트","raidExp":2600000,"castleExp":2600000,"equipComment":"예쁜데 강하기까지 하면 반칙인가?","tierExclusive":true,"effect":"보라보라하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 260만 증가합니다.","sourceIndex":73,"sourceKey":"skill_073","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"💟 보라보라하트의 자수정 귀걸이","grade":"B","rate":0,"requiredTier":"보라보라하트","raidExp":2600000,"castleExp":2600000,"equipComment":"예쁜데 강하기까지 하면 반칙인가?","tierExclusive":true,"effect":"보라보라하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 260만 증가합니다.","sourceIndex":73,"sourceKey":"skill_073","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_073', 'SKILL', '💟 보라보라하트의 자수정 귀걸이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_073","sourceIndex":73,"sourceKey":"skill_073","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '💟 보라보라하트의 자수정 귀걸이'
FROM object_registry WHERE object_key = 'skill.pet_skill_073';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_073'
FROM object_registry WHERE object_key = 'skill.pet_skill_073';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_074', '🫶 손하트의 인연 반지', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🫶 손하트의 인연 반지","grade":"B","rate":0,"requiredTier":"손하트","raidExp":3000000,"castleExp":3000000,"equipComment":"자, 모두에게 하트 발사!","tierExclusive":true,"effect":"손하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 300만 증가합니다.","sourceIndex":74,"sourceKey":"skill_074","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🫶 손하트의 인연 반지","grade":"B","rate":0,"requiredTier":"손하트","raidExp":3000000,"castleExp":3000000,"equipComment":"자, 모두에게 하트 발사!","tierExclusive":true,"effect":"손하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 300만 증가합니다.","sourceIndex":74,"sourceKey":"skill_074","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_074', 'SKILL', '🫶 손하트의 인연 반지', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_074","sourceIndex":74,"sourceKey":"skill_074","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🫶 손하트의 인연 반지'
FROM object_registry WHERE object_key = 'skill.pet_skill_074';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_074'
FROM object_registry WHERE object_key = 'skill.pet_skill_074';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_075', '♠️ 스페이드의 사신 흑창', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♠️ 스페이드의 사신 흑창","grade":"B","rate":0,"requiredTier":"스페이드","raidExp":3500000,"castleExp":3500000,"equipComment":"무서워하지 마, 살짝만 찌를게!","tierExclusive":true,"effect":"스페이드 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 350만 증가합니다.","sourceIndex":75,"sourceKey":"skill_075","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♠️ 스페이드의 사신 흑창","grade":"B","rate":0,"requiredTier":"스페이드","raidExp":3500000,"castleExp":3500000,"equipComment":"무서워하지 마, 살짝만 찌를게!","tierExclusive":true,"effect":"스페이드 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 350만 증가합니다.","sourceIndex":75,"sourceKey":"skill_075","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_075', 'SKILL', '♠️ 스페이드의 사신 흑창', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_075","sourceIndex":75,"sourceKey":"skill_075","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"B","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '♠️ 스페이드의 사신 흑창'
FROM object_registry WHERE object_key = 'skill.pet_skill_075';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_075'
FROM object_registry WHERE object_key = 'skill.pet_skill_075';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_076', '♥️ 하트의 생명 목걸이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♥️ 하트의 생명 목걸이","grade":"A","rate":0,"requiredTier":"하트","raidExp":4000000,"castleExp":4000000,"equipComment":"심장이 콩닥콩닥! 아직 살아 있다!","tierExclusive":true,"effect":"하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 400만 증가합니다.","sourceIndex":76,"sourceKey":"skill_076","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♥️ 하트의 생명 목걸이","grade":"A","rate":0,"requiredTier":"하트","raidExp":4000000,"castleExp":4000000,"equipComment":"심장이 콩닥콩닥! 아직 살아 있다!","tierExclusive":true,"effect":"하트 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 400만 증가합니다.","sourceIndex":76,"sourceKey":"skill_076","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_076', 'SKILL', '♥️ 하트의 생명 목걸이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_076","sourceIndex":76,"sourceKey":"skill_076","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '♥️ 하트의 생명 목걸이'
FROM object_registry WHERE object_key = 'skill.pet_skill_076';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_076'
FROM object_registry WHERE object_key = 'skill.pet_skill_076';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_077', '♦️ 다이아몬드의 불멸검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♦️ 다이아몬드의 불멸검","grade":"A","rate":0,"requiredTier":"다이아몬드","raidExp":4600000,"castleExp":4600000,"equipComment":"아 뜨거 뜨거!","tierExclusive":true,"effect":"다이아몬드 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 460만 증가합니다.","sourceIndex":77,"sourceKey":"skill_077","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♦️ 다이아몬드의 불멸검","grade":"A","rate":0,"requiredTier":"다이아몬드","raidExp":4600000,"castleExp":4600000,"equipComment":"아 뜨거 뜨거!","tierExclusive":true,"effect":"다이아몬드 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 460만 증가합니다.","sourceIndex":77,"sourceKey":"skill_077","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_077', 'SKILL', '♦️ 다이아몬드의 불멸검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_077","sourceIndex":77,"sourceKey":"skill_077","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '♦️ 다이아몬드의 불멸검'
FROM object_registry WHERE object_key = 'skill.pet_skill_077';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_077'
FROM object_registry WHERE object_key = 'skill.pet_skill_077';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_078', '♣️ 클로바의 행운 지팡이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♣️ 클로바의 행운 지팡이","grade":"A","rate":0,"requiredTier":"클로바","raidExp":5200000,"castleExp":5200000,"equipComment":"오늘은 왠지 뽑기가 잘될 것 같아!","tierExclusive":true,"effect":"클로바 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 520만 증가합니다.","sourceIndex":78,"sourceKey":"skill_078","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"♣️ 클로바의 행운 지팡이","grade":"A","rate":0,"requiredTier":"클로바","raidExp":5200000,"castleExp":5200000,"equipComment":"오늘은 왠지 뽑기가 잘될 것 같아!","tierExclusive":true,"effect":"클로바 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 520만 증가합니다.","sourceIndex":78,"sourceKey":"skill_078","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_078', 'SKILL', '♣️ 클로바의 행운 지팡이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_078","sourceIndex":78,"sourceKey":"skill_078","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '♣️ 클로바의 행운 지팡이'
FROM object_registry WHERE object_key = 'skill.pet_skill_078';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_078'
FROM object_registry WHERE object_key = 'skill.pet_skill_078';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_079', '🃏 풀하우스의 승부 카드', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🃏 풀하우스의 승부 카드","grade":"A","rate":0,"requiredTier":"풀하우스","raidExp":6000000,"castleExp":6000000,"equipComment":"올인! 내 포인트도 올인!","tierExclusive":true,"effect":"풀하우스 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 600만 증가합니다.","sourceIndex":79,"sourceKey":"skill_079","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🃏 풀하우스의 승부 카드","grade":"A","rate":0,"requiredTier":"풀하우스","raidExp":6000000,"castleExp":6000000,"equipComment":"올인! 내 포인트도 올인!","tierExclusive":true,"effect":"풀하우스 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 600만 증가합니다.","sourceIndex":79,"sourceKey":"skill_079","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_079', 'SKILL', '🃏 풀하우스의 승부 카드', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_079","sourceIndex":79,"sourceKey":"skill_079","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🃏 풀하우스의 승부 카드'
FROM object_registry WHERE object_key = 'skill.pet_skill_079';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_079'
FROM object_registry WHERE object_key = 'skill.pet_skill_079';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_080', '🧸 곰찌의 수호 인형', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🧸 곰찌의 수호 인형","grade":"A","rate":0,"requiredTier":"곰찌","raidExp":7000000,"castleExp":7000000,"equipComment":"귀엽다고 얕보면 곰 발바닥 간다!","tierExclusive":true,"effect":"곰찌 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 700만 증가합니다.","sourceIndex":80,"sourceKey":"skill_080","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🧸 곰찌의 수호 인형","grade":"A","rate":0,"requiredTier":"곰찌","raidExp":7000000,"castleExp":7000000,"equipComment":"귀엽다고 얕보면 곰 발바닥 간다!","tierExclusive":true,"effect":"곰찌 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 700만 증가합니다.","sourceIndex":80,"sourceKey":"skill_080","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_080', 'SKILL', '🧸 곰찌의 수호 인형', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_080","sourceIndex":80,"sourceKey":"skill_080","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🧸 곰찌의 수호 인형'
FROM object_registry WHERE object_key = 'skill.pet_skill_080';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_080'
FROM object_registry WHERE object_key = 'skill.pet_skill_080';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_081', '🌱 초심의 모험가 단검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🌱 초심의 모험가 단검","grade":"A","rate":0,"requiredTier":"초심","raidExp":8000000,"castleExp":8000000,"equipComment":"작지만 따끔하다구!","tierExclusive":true,"effect":"초심 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 800만 증가합니다.","sourceIndex":81,"sourceKey":"skill_081","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🌱 초심의 모험가 단검","grade":"A","rate":0,"requiredTier":"초심","raidExp":8000000,"castleExp":8000000,"equipComment":"작지만 따끔하다구!","tierExclusive":true,"effect":"초심 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 800만 증가합니다.","sourceIndex":81,"sourceKey":"skill_081","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_081', 'SKILL', '🌱 초심의 모험가 단검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_081","sourceIndex":81,"sourceKey":"skill_081","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🌱 초심의 모험가 단검'
FROM object_registry WHERE object_key = 'skill.pet_skill_081';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_081'
FROM object_registry WHERE object_key = 'skill.pet_skill_081';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_082', '🌸 벚꽃의 천화앵검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🌸 벚꽃의 천화앵검","grade":"A","rate":0,"requiredTier":"벛꽃","raidExp":9000000,"castleExp":9000000,"equipComment":"예쁘게 피고, 화려하게 벤다!","tierExclusive":true,"effect":"벛꽃 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 900만 증가합니다.","sourceIndex":82,"sourceKey":"skill_082","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🌸 벚꽃의 천화앵검","grade":"A","rate":0,"requiredTier":"벛꽃","raidExp":9000000,"castleExp":9000000,"equipComment":"예쁘게 피고, 화려하게 벤다!","tierExclusive":true,"effect":"벛꽃 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 900만 증가합니다.","sourceIndex":82,"sourceKey":"skill_082","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_082', 'SKILL', '🌸 벚꽃의 천화앵검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_082","sourceIndex":82,"sourceKey":"skill_082","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🌸 벚꽃의 천화앵검'
FROM object_registry WHERE object_key = 'skill.pet_skill_082';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_082'
FROM object_registry WHERE object_key = 'skill.pet_skill_082';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_083', '🎲 해피왕의 운명 주사위', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🎲 해피왕의 운명 주사위","grade":"A","rate":0,"requiredTier":"해피왕","raidExp":10000000,"castleExp":10000000,"equipComment":"주사위야, 제발 눈치 좀 챙겨줘!","tierExclusive":true,"effect":"해피왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,000만 증가합니다.","sourceIndex":83,"sourceKey":"skill_083","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🎲 해피왕의 운명 주사위","grade":"A","rate":0,"requiredTier":"해피왕","raidExp":10000000,"castleExp":10000000,"equipComment":"주사위야, 제발 눈치 좀 챙겨줘!","tierExclusive":true,"effect":"해피왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,000만 증가합니다.","sourceIndex":83,"sourceKey":"skill_083","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_083', 'SKILL', '🎲 해피왕의 운명 주사위', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_083","sourceIndex":83,"sourceKey":"skill_083","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"A","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🎲 해피왕의 운명 주사위'
FROM object_registry WHERE object_key = 'skill.pet_skill_083';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_083'
FROM object_registry WHERE object_key = 'skill.pet_skill_083';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_084', '😈 마왕의 멸망검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"😈 마왕의 멸망검","grade":"S","rate":0,"requiredTier":"마왕","raidExp":12000000,"castleExp":12000000,"equipComment":"크하하하! 오늘 저녁은 뭐 먹지?","tierExclusive":true,"effect":"마왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,200만 증가합니다.","sourceIndex":84,"sourceKey":"skill_084","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"😈 마왕의 멸망검","grade":"S","rate":0,"requiredTier":"마왕","raidExp":12000000,"castleExp":12000000,"equipComment":"크하하하! 오늘 저녁은 뭐 먹지?","tierExclusive":true,"effect":"마왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,200만 증가합니다.","sourceIndex":84,"sourceKey":"skill_084","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_084', 'SKILL', '😈 마왕의 멸망검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_084","sourceIndex":84,"sourceKey":"skill_084","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '😈 마왕의 멸망검'
FROM object_registry WHERE object_key = 'skill.pet_skill_084';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_084'
FROM object_registry WHERE object_key = 'skill.pet_skill_084';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_085', '🦄 페가수스의 성운 신창', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🦄 페가수스의 성운 신창","grade":"S","rate":0,"requiredTier":"페가수스","raidExp":14000000,"castleExp":14000000,"equipComment":"비켜! 유니콘 지나간다!","tierExclusive":true,"effect":"페가수스 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,400만 증가합니다.","sourceIndex":85,"sourceKey":"skill_085","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🦄 페가수스의 성운 신창","grade":"S","rate":0,"requiredTier":"페가수스","raidExp":14000000,"castleExp":14000000,"equipComment":"비켜! 유니콘 지나간다!","tierExclusive":true,"effect":"페가수스 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,400만 증가합니다.","sourceIndex":85,"sourceKey":"skill_085","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_085', 'SKILL', '🦄 페가수스의 성운 신창', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_085","sourceIndex":85,"sourceKey":"skill_085","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🦄 페가수스의 성운 신창'
FROM object_registry WHERE object_key = 'skill.pet_skill_085';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_085'
FROM object_registry WHERE object_key = 'skill.pet_skill_085';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_086', '👻 유령왕의 망령낫', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"👻 유령왕의 망령낫","grade":"S","rate":0,"requiredTier":"유령왕","raidExp":16000000,"castleExp":16000000,"equipComment":"뒤를 봐… 아니, 보지 마!","tierExclusive":true,"effect":"유령왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,600만 증가합니다.","sourceIndex":86,"sourceKey":"skill_086","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"👻 유령왕의 망령낫","grade":"S","rate":0,"requiredTier":"유령왕","raidExp":16000000,"castleExp":16000000,"equipComment":"뒤를 봐… 아니, 보지 마!","tierExclusive":true,"effect":"유령왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,600만 증가합니다.","sourceIndex":86,"sourceKey":"skill_086","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_086', 'SKILL', '👻 유령왕의 망령낫', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_086","sourceIndex":86,"sourceKey":"skill_086","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '👻 유령왕의 망령낫'
FROM object_registry WHERE object_key = 'skill.pet_skill_086';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_086'
FROM object_registry WHERE object_key = 'skill.pet_skill_086';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_087', '🐶 왕왕왕의 수호왕 갑주', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🐶 왕왕왕의 수호왕 갑주","grade":"S","rate":0,"requiredTier":"왕왕왕","raidExp":18000000,"castleExp":18000000,"equipComment":"왕왕! 물지는 않고 때릴게!","tierExclusive":true,"effect":"왕왕왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,800만 증가합니다.","sourceIndex":87,"sourceKey":"skill_087","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🐶 왕왕왕의 수호왕 갑주","grade":"S","rate":0,"requiredTier":"왕왕왕","raidExp":18000000,"castleExp":18000000,"equipComment":"왕왕! 물지는 않고 때릴게!","tierExclusive":true,"effect":"왕왕왕 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 1,800만 증가합니다.","sourceIndex":87,"sourceKey":"skill_087","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_087', 'SKILL', '🐶 왕왕왕의 수호왕 갑주', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_087","sourceIndex":87,"sourceKey":"skill_087","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🐶 왕왕왕의 수호왕 갑주'
FROM object_registry WHERE object_key = 'skill.pet_skill_087';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_087'
FROM object_registry WHERE object_key = 'skill.pet_skill_087';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_088', '🐉 용용용의 용신 여의주', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🐉 용용용의 용신 여의주","grade":"S","rate":0,"requiredTier":"용용용","raidExp":21000000,"castleExp":21000000,"equipComment":"소원을 말해 봐! 들어준다고는 안 했어!","tierExclusive":true,"effect":"용용용 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 2,100만 증가합니다.","sourceIndex":88,"sourceKey":"skill_088","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🐉 용용용의 용신 여의주","grade":"S","rate":0,"requiredTier":"용용용","raidExp":21000000,"castleExp":21000000,"equipComment":"소원을 말해 봐! 들어준다고는 안 했어!","tierExclusive":true,"effect":"용용용 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 2,100만 증가합니다.","sourceIndex":88,"sourceKey":"skill_088","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_088', 'SKILL', '🐉 용용용의 용신 여의주', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_088","sourceIndex":88,"sourceKey":"skill_088","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🐉 용용용의 용신 여의주'
FROM object_registry WHERE object_key = 'skill.pet_skill_088';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_088'
FROM object_registry WHERE object_key = 'skill.pet_skill_088';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_source_089', '🐦‍🔥 피닉스의 불멸 성검', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🐦‍🔥 피닉스의 불멸 성검","grade":"S","rate":0,"requiredTier":"피닉스","raidExp":25000000,"castleExp":25000000,"equipComment":"타버렸다… 아니, 다시 살아났다!","tierExclusive":true,"effect":"피닉스 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 2,500만 증가합니다.","sourceIndex":89,"sourceKey":"skill_089","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"🐦‍🔥 피닉스의 불멸 성검","grade":"S","rate":0,"requiredTier":"피닉스","raidExp":25000000,"castleExp":25000000,"equipComment":"타버렸다… 아니, 다시 살아났다!","tierExclusive":true,"effect":"피닉스 티어부터 장착할 수 있습니다.\\n장착 시 레이드/캐슬 매력 각각 2,500만 증가합니다.","sourceIndex":89,"sourceKey":"skill_089","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_089', 'SKILL', '🐦‍🔥 피닉스의 불멸 성검', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01","definitionCode":"pet_skill_source_089","sourceIndex":89,"sourceKey":"skill_089","sourceHash":"595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f","grade":"S","rate":0,"tierExclusive":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '🐦‍🔥 피닉스의 불멸 성검'
FROM object_registry WHERE object_key = 'skill.pet_skill_089';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_089'
FROM object_registry WHERE object_key = 'skill.pet_skill_089';

COMMIT;
