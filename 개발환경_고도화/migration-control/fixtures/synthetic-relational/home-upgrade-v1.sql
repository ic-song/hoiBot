DELETE FROM outbox_messages WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'home.upgrade:%:900000004'
);
DELETE FROM command_audit WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'home.upgrade:%:900000004'
);
DELETE FROM command_executions WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'home.upgrade:%:900000004'
);
DELETE FROM inventory_ledger WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'home.upgrade:%:900000004'
);
DELETE FROM operations WHERE idempotency_scope LIKE 'home.upgrade:%:900000004';
DELETE FROM event_inbox WHERE event_id IN ('home-upgrade-preview-v1', 'home-upgrade-execute-v1');
DELETE FROM home_upgrade_confirmations WHERE player_id IN (900000001, 900000002);
DELETE FROM home_upgrade_requirements WHERE definition_id IN (SELECT id FROM home_upgrade_definitions WHERE floor_area IN (1, 2));
DELETE FROM home_upgrade_definitions WHERE floor_area IN (1, 2);

INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, active, version) VALUES
  ('synthetic-home-wood', '합성 목재', 'material', TRUE, TRUE, 1),
  ('synthetic-home-stone', '합성 석재', 'material', TRUE, TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE;

INSERT INTO home_upgrade_definitions (floor_area, display_name, experience_reward, version, active) VALUES
  (1, '합성 오두막', 100, 1, TRUE),
  (2, '합성 작은집', 250, 1, TRUE);

INSERT INTO home_upgrade_requirements (definition_id, item_id, quantity)
SELECT definition.id, item.id, requirement.quantity
FROM (SELECT 1 AS floor_area, 'synthetic-home-wood' AS item_code, 3 AS quantity
      UNION ALL SELECT 1, 'synthetic-home-stone', 2
      UNION ALL SELECT 2, 'synthetic-home-wood', 5) requirement
JOIN home_upgrade_definitions definition ON definition.floor_area = requirement.floor_area
JOIN item_definitions item ON item.code = requirement.item_code;

INSERT INTO player_pets (player_id, display_name, experience, version)
VALUES (900000001, '합성펫', 0, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), experience = 0, version = version + 1;

INSERT INTO player_homes (player_id, display_name, base_experience, floor_area, version)
VALUES (900000001, '빈 터', 0, 0, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), base_experience = 0, floor_area = 0, version = version + 1;

INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
SELECT 900000001, id, CASE code WHEN 'synthetic-home-wood' THEN 10 ELSE 5 END, 1
FROM item_definitions WHERE code IN ('synthetic-home-wood', 'synthetic-home-stone')
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = inventory_stacks.version + 1;
