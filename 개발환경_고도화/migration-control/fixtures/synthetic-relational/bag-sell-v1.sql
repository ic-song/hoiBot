INSERT INTO currency_definitions (code, display_name, scale_digits, active)
VALUES ('point', '포인트', 0, TRUE)
ON DUPLICATE KEY UPDATE active = TRUE;

INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('bag_sell_test', '판매 테스트', 'legacy_bag_item', TRUE, JSON_OBJECT('legacyBagOrder', 990, 'sellable', TRUE), TRUE, 1),
  ('bag_sell_forbidden', '판매 금지 테스트', 'legacy_bag_item', TRUE, JSON_OBJECT('legacyBagOrder', 991, 'neverSell', TRUE), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), metadata_json = VALUES(metadata_json), active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES ('item.bag_sell_test', 'ITEM', '판매 테스트', TRUE, JSON_OBJECT('stackable', TRUE))
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE;

INSERT INTO object_source_bindings
  (object_id, object_type, source_system, source_table, source_key)
SELECT registry.id, registry.object_type, 'RUNTIME_DB', 'item_definitions', 'bag_sell_test'
FROM object_registry registry WHERE registry.object_key = 'item.bag_sell_test'
ON DUPLICATE KEY UPDATE object_id = VALUES(object_id);

INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
SELECT 900000001, item.id, 5, 1 FROM item_definitions item WHERE item.code = 'bag_sell_test'
ON DUPLICATE KEY UPDATE quantity = 5, version = inventory_stacks.version + 1;

INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
SELECT 900000001, item.id, 2, 1 FROM item_definitions item WHERE item.code = 'bag_sell_forbidden'
ON DUPLICATE KEY UPDATE quantity = 2, version = inventory_stacks.version + 1;

INSERT INTO currency_accounts (player_id, currency_code, balance, version)
VALUES (900000001, 'point', 1000, 1)
ON DUPLICATE KEY UPDATE balance = 1000, version = version + 1;
