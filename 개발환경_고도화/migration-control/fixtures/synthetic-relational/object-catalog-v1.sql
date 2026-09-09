INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json) VALUES
  ('item.test_potion', 'ITEM', '테스트 물약', TRUE, JSON_OBJECT('stackable', TRUE)),
  ('pet.test_dragon', 'PET', '테스트 드래곤', TRUE, JSON_OBJECT('species', 'dragon')),
  ('furniture.test_chair', 'FURNITURE', '테스트 의자', TRUE, JSON_OBJECT('slot', 'floor')),
  ('title.test_hero', 'TITLE', '테스트 영웅', TRUE, JSON_OBJECT()),
  ('pet_title.test_friend', 'PET_TITLE', '테스트 단짝', TRUE, JSON_OBJECT()),
  ('package.test_starter', 'PACKAGE', '테스트 스타터', TRUE, JSON_OBJECT()),
  ('currency.test_gold', 'CURRENCY', '테스트 골드', TRUE, JSON_OBJECT('scale', 0)),
  ('item.test_retired', 'ITEM', '종료된 테스트 아이템', FALSE, JSON_OBJECT())
ON DUPLICATE KEY UPDATE object_key = VALUES(object_key);

INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '물약' FROM object_registry WHERE object_key = 'item.test_potion'
ON DUPLICATE KEY UPDATE object_id = VALUES(object_id);
INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'display_name', '테스트 공통' FROM object_registry WHERE object_key = 'item.test_potion'
ON DUPLICATE KEY UPDATE object_id = VALUES(object_id);
INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'display_name', '테스트 공통' FROM object_registry WHERE object_key = 'pet.test_dragon'
ON DUPLICATE KEY UPDATE object_id = VALUES(object_id);
INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', display_name FROM object_registry
WHERE object_key IN (
  'furniture.test_chair', 'title.test_hero', 'pet_title.test_friend',
  'package.test_starter', 'currency.test_gold'
)
ON DUPLICATE KEY UPDATE object_id = VALUES(object_id);

INSERT INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON',
  CASE object_type
    WHEN 'ITEM' THEN 'itemInfo'
    WHEN 'PET' THEN 'member_pet'
    WHEN 'FURNITURE' THEN 'petSweetHomeInfo'
    WHEN 'TITLE' THEN 'member_title'
    WHEN 'PET_TITLE' THEN 'pet_title'
    WHEN 'PACKAGE' THEN 'packageInfo'
    WHEN 'CURRENCY' THEN 'member'
  END,
  display_name
FROM object_registry
WHERE object_key IN (
  'item.test_potion', 'pet.test_dragon', 'furniture.test_chair', 'title.test_hero',
  'pet_title.test_friend', 'package.test_starter', 'currency.test_gold'
)
ON DUPLICATE KEY UPDATE object_id = VALUES(object_id);
