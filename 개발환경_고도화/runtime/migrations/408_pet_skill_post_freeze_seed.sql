START TRANSACTION;

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_legendary_club', '전설의 몽둥이', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"전설의 몽둥이","grade":"한정판","limitedEdition":true,"openable":false,"directGrantOnly":true,"directGrantOperator":"호이 남","directGrantUsage":"/펫스킬가방추가 [이름], 전설의 몽둥이 [숫자]","raidExp":500000,"castleExp":500000,"equipComment":"오오.. 영롱하군요 너..빌런인가?","effect":"오톡 빌런을 때려잡는 전설의 몽둥이 입니다.\\n장착 시 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.\\n※펫스킬오픈으로 획득 불가","sourceIndex":90,"runtimeSourceIndex":0,"sourceKey":"skill_090","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"전설의 몽둥이","grade":"한정판","limitedEdition":true,"openable":false,"directGrantOnly":true,"directGrantOperator":"호이 남","directGrantUsage":"/펫스킬가방추가 [이름], 전설의 몽둥이 [숫자]","raidExp":500000,"castleExp":500000,"equipComment":"오오.. 영롱하군요 너..빌런인가?","effect":"오톡 빌런을 때려잡는 전설의 몽둥이 입니다.\\n장착 시 레이드매력 50만과 캐슬매력 50만, 총 종합매력 100만을 획득합니다.\\n펫스킬을 해제하면 지급된 매력은 회수됩니다.\\n※펫스킬오픈으로 획득 불가","sourceIndex":90,"runtimeSourceIndex":0,"sourceKey":"skill_090","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_090', 'SKILL', '전설의 몽둥이', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.435-8f075b4e-02","definitionCode":"pet_skill_legendary_club","sourceIndex":90,"runtimeSourceIndex":0,"sourceKey":"skill_090","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176","grade":"한정판","rate":0,"tierExclusive":false,"postFreeze":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '전설의 몽둥이'
FROM object_registry WHERE object_key = 'skill.pet_skill_090';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_090'
FROM object_registry WHERE object_key = 'skill.pet_skill_090';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_musou_ghost', '무쌍귀신', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"무쌍귀신","grade":"A","rate":1.7,"equipComment":"촹 촹 챙챙 슈슉 슈슉 윽! 악!","equipCommentNoColon":true,"effect":"펫무쌍 대회 시작 시 개인 공격 횟수가 1회 증가합니다.\\n펫무쌍 공격 보상 지급 시 포인트 1억을 추가로 획득합니다.\\n※ 무쌍신화📙와 중복되지 않습니다.","sourceIndex":91,"runtimeSourceIndex":29,"sourceKey":"skill_091","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"무쌍귀신","grade":"A","rate":1.7,"equipComment":"촹 촹 챙챙 슈슉 슈슉 윽! 악!","equipCommentNoColon":true,"effect":"펫무쌍 대회 시작 시 개인 공격 횟수가 1회 증가합니다.\\n펫무쌍 공격 보상 지급 시 포인트 1억을 추가로 획득합니다.\\n※ 무쌍신화📙와 중복되지 않습니다.","sourceIndex":91,"runtimeSourceIndex":29,"sourceKey":"skill_091","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_091', 'SKILL', '무쌍귀신', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.435-8f075b4e-02","definitionCode":"pet_skill_musou_ghost","sourceIndex":91,"runtimeSourceIndex":29,"sourceKey":"skill_091","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176","grade":"A","rate":1.7,"tierExclusive":false,"postFreeze":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '무쌍귀신'
FROM object_registry WHERE object_key = 'skill.pet_skill_091';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_091'
FROM object_registry WHERE object_key = 'skill.pet_skill_091';

INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES ('pet_skill_musou_myth', '무쌍신화', JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"무쌍신화","grade":"B","rate":0.9195,"fixedRate":true,"equipComment":"슈슉..슈슈슉..챙..챙..챙!","equipCommentNoColon":true,"effect":"펫무쌍 대회 시작 시 개인 공격 횟수가 1회 증가합니다.\\n※ 무쌍귀신📙과 중복되지 않습니다.","sourceIndex":92,"runtimeSourceIndex":41,"sourceKey":"skill_092","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('{"name":"무쌍신화","grade":"B","rate":0.9195,"fixedRate":true,"equipComment":"슈슉..슈슈슉..챙..챙..챙!","equipCommentNoColon":true,"effect":"펫무쌍 대회 시작 시 개인 공격 횟수가 1회 증가합니다.\\n※ 무쌍귀신📙과 중복되지 않습니다.","sourceIndex":92,"runtimeSourceIndex":41,"sourceKey":"skill_092","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('skill.pet_skill_092', 'SKILL', '무쌍신화', TRUE, JSON_EXTRACT('{"catalogVersion":"ASSET-FREEZE-v2.435-8f075b4e-02","definitionCode":"pet_skill_musou_myth","sourceIndex":92,"runtimeSourceIndex":41,"sourceKey":"skill_092","sourceHash":"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176","grade":"B","rate":0.9195,"tierExclusive":false,"postFreeze":true}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '무쌍신화'
FROM object_registry WHERE object_key = 'skill.pet_skill_092';

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'skill_092'
FROM object_registry WHERE object_key = 'skill.pet_skill_092';

COMMIT;
