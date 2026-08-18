INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('bag_b2fd551a03f6fe6e', '컬렉션창세패키지🐹(/컬렉션창세오픈)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '컬렉션창세패키지🐹(/컬렉션창세오픈)'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code),
  stackable = VALUES(stackable), metadata_json = VALUES(metadata_json), active = VALUES(active);

INSERT INTO mini_pet_definitions
  (code, display_name, grade_code, grade_display_name, emoji_value, active)
VALUES
  ('mini_pet_83a8d8d4c759c2a6', '컬렉션창세 미니펫', 'grade_96c06895d65b243a', '창세', '🐹', TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = VALUES(active);
