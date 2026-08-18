INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
  (910000020, 'bag_9b3e69dbd2e91260', '정령조각🥀', 'consumable', TRUE, JSON_OBJECT('legacyBagName', '정령조각🥀', 'synthetic', TRUE), TRUE, 1),
  (910000021, 'bag_55b34cbde0088b29', '정령 강화석🥀', 'consumable', TRUE, JSON_OBJECT('legacyBagName', '정령 강화석🥀', 'synthetic', TRUE), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), stackable = VALUES(stackable), active = VALUES(active);

INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES
  (900000001, 910000020, 20, 1),
  (900000001, 910000021, 5, 1)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = version + 1;
