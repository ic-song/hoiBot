INSERT INTO mini_pet_projection_environment_identity
  (singleton_id, environment_code, database_identity)
VALUES (1, 'dev', '00000000-0000-4000-8000-000000000350')
ON DUPLICATE KEY UPDATE environment_code = VALUES(environment_code);

UPDATE owned_mini_pets
SET equipped = FALSE, battle_experience = 20
WHERE id = 900000001 AND player_id = 900000001;

INSERT INTO owned_mini_pets
  (id, player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
   battle_experience, castle_experience, raid_experience, equipped)
VALUES (900000011, 900000001, 900000001, '합성둘째', 0, 0, 10, 0, 0, FALSE)
ON DUPLICATE KEY UPDATE custom_name = VALUES(custom_name), battle_experience = VALUES(battle_experience), equipped = FALSE;

INSERT INTO mini_pet_inventory_player_states (player_id, bag_shape_code, capacity_limit, version)
VALUES (900000001, 'missing', 100, 1)
ON DUPLICATE KEY UPDATE bag_shape_code = 'missing', capacity_limit = 100, version = version + 1;

UPDATE mini_pet_inventory_owned_states SET sort_index = NULL WHERE player_id = 900000001;

INSERT INTO mini_pet_inventory_owned_states
  (owned_mini_pet_id, player_id, stable_owned_id, sort_index, version)
VALUES (900000001, 900000001, '00000000-0000-4000-8000-000000350001', 2, 1)
ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), sort_index = VALUES(sort_index), version = version + 1;

INSERT INTO mini_pet_inventory_owned_states
  (owned_mini_pet_id, player_id, stable_owned_id, sort_index, version)
VALUES (900000011, 900000001, '00000000-0000-4000-8000-000000350011', 1, 1)
ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), sort_index = VALUES(sort_index), version = version + 1;
