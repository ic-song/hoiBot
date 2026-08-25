INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('carrot_thermometer', '당근온도기', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '당근온도기'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code),
  stackable = VALUES(stackable), metadata_json = VALUES(metadata_json), active = VALUES(active);
