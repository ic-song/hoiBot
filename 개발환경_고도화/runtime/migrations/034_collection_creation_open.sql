INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('bag_11319869697c3c00', '컬렉션창조패키지🐹(/컬렉션창조오픈)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '컬렉션창조패키지🐹(/컬렉션창조오픈)'), TRUE, 1),
  ('bag_3241894752b82f7a', '미니펫뽑기🐹(/미니펫오픈)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '미니펫뽑기🐹(/미니펫오픈)'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  asset_type_code = VALUES(asset_type_code),
  stackable = VALUES(stackable),
  metadata_json = VALUES(metadata_json),
  active = VALUES(active);

INSERT INTO mini_pet_definitions
  (code, display_name, grade_code, grade_display_name, emoji_value, active)
VALUES
  ('mini_pet_f879f4cf45f6a74d', '컬렉션창조 미니펫', 'grade_0f83fc6041262eb9', '창조', '🐹', TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name),
  emoji_value = VALUES(emoji_value),
  active = VALUES(active);
