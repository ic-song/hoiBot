INSERT INTO currency_definitions (code, display_name, scale_digits)
VALUES ('guild_experience', '길드 경험치', 0)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), scale_digits = VALUES(scale_digits);

INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
  ('guild_warehouse_pendant', '길드창고 펜던트📿', 'guild_resource', TRUE, JSON_OBJECT('legacyGuildWarehouseField', 'pendant'), TRUE, 1),
  ('guild_warehouse_pet_enhance', '길드창고 펫 강화⭐️', 'guild_resource', TRUE, JSON_OBJECT('legacyGuildWarehouseField', 'pet'), TRUE, 1),
  ('guild_warehouse_mini_pet_enhance', '길드창고 미니펫 강화💫', 'guild_resource', TRUE, JSON_OBJECT('legacyGuildWarehouseField', 'miniPet'), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code),
  stackable = VALUES(stackable), metadata_json = VALUES(metadata_json), active = VALUES(active);
