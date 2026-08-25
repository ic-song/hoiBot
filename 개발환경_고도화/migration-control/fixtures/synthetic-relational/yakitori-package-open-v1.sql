INSERT INTO mini_pet_projection_environment_identity
  (singleton_id, environment_code, database_identity)
VALUES (1, 'dev', '00000000-0000-4000-8000-000000000282')
ON DUPLICATE KEY UPDATE environment_code = VALUES(environment_code);

INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
SELECT 900000001, definition.id,
  CASE WHEN definition.code = 'bag_yakitori_package_10' THEN 1 ELSE 0 END, 1
FROM item_definitions definition
WHERE definition.code IN ('bag_yakitori_package_10', 'bag_3241894752b82f7a')
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = inventory_stacks.version + 1;
