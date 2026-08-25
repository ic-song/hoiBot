DELETE FROM outbox_messages WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:equipped_rank');
DELETE FROM command_audit WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:equipped_rank');
DELETE FROM command_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:equipped_rank');
DELETE FROM mini_pet_read_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:equipped_rank');
DELETE FROM operations WHERE idempotency_scope = 'mini-pet.public.read:equipped_rank';
DELETE FROM event_inbox WHERE event_id IN ('minipet-rank-probe-v1', 'minipet-rank-rollback-v1', 'minipet-rank-recovery-v1');

INSERT INTO event_inbox
  (event_id, provider_event_id, external_channel_id, external_user_id, event_kind,
   direction, payload_hash, processing_status, received_at)
VALUES
  ('minipet-rank-probe-v1', 'minipet-rank-probe-v1', 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('1', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-rank-rollback-v1', 'minipet-rank-rollback-v1', 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('2', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-rank-recovery-v1', 'minipet-rank-recovery-v1', 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('3', 64), 'processed', UTC_TIMESTAMP(3));

DELETE FROM mini_pet_catalog_entries WHERE environment_code = 'dev' AND pool_version = 'equipped-rank-v1';
DELETE FROM mini_pet_catalog_snapshots WHERE environment_code = 'dev' AND pool_version = 'equipped-rank-v1';
DELETE FROM mini_pet_owned_read_snapshots WHERE environment_code = 'dev' AND snapshot_version = 'equipped-owned-v1';
DELETE FROM mini_pet_owner_read_snapshots WHERE environment_code = 'dev' AND snapshot_version = 'equipped-owned-v1';
DELETE FROM mini_pet_owned_snapshot_versions WHERE environment_code = 'dev' AND snapshot_version = 'equipped-owned-v1';

INSERT INTO mini_pet_projection_environment_identity (singleton_id, environment_code, database_identity)
VALUES (1, 'dev', '00000000-0000-4000-8000-000000000361')
ON DUPLICATE KEY UPDATE environment_code = VALUES(environment_code), database_identity = VALUES(database_identity);

INSERT INTO owned_mini_pets
  (id, player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
   battle_experience, castle_experience, raid_experience, equipped)
VALUES
  (900000021, 900000002, 900000001, '합성베타', 0, 0, 100, 0, 0, TRUE),
  (900000031, 900000003, 900000001, '합성감마', 0, 0, 50, 0, 0, TRUE)
ON DUPLICATE KEY UPDATE custom_name = VALUES(custom_name), battle_experience = VALUES(battle_experience), equipped = TRUE;
UPDATE owned_mini_pets SET custom_name = '합성알파', battle_experience = 100, equipped = TRUE WHERE id = 900000001;

INSERT INTO mini_pet_owned_snapshot_versions (environment_code, snapshot_version, captured_at)
VALUES ('dev', 'equipped-owned-v1', '2026-08-25 02:00:00.000');
INSERT INTO mini_pet_owner_read_snapshots
  (environment_code, snapshot_version, player_id, owner_display_name, owner_check_rank, captured_at)
VALUES
  ('dev', 'equipped-owned-v1', 900000001, '테스트알파', '🧪테스트알파', '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000002, '테스트베타', '🧪테스트베타', '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000003, '테스트감마', '🧪테스트감마', '2026-08-25 02:00:00.000');
INSERT INTO mini_pet_owned_read_snapshots
  (environment_code, snapshot_version, owned_mini_pet_id, player_id, mini_pet_definition_id,
   custom_name, battle_experience, equipped)
SELECT 'dev', 'equipped-owned-v1', owned.id, owned.player_id, owned.mini_pet_definition_id,
  owned.custom_name, owned.battle_experience, TRUE
FROM owned_mini_pets owned WHERE owned.id IN (900000001, 900000021, 900000031);

INSERT INTO mini_pet_catalog_snapshots
  (pool_version, environment_code, catalog_kind, definition_version, owned_snapshot_version, snapshot_at,
   grade_table_json, allowed_grades_json, stage_rewards_json, total_raw_probability,
   total_normalized_rate, zero_total, status)
VALUES
  ('equipped-rank-v1', 'dev', 'fixed_reward', 'definition-v1', 'equipped-owned-v1', '2026-08-25 02:00:00.000',
   JSON_OBJECT('일반', '일반'), JSON_ARRAY('일반'), JSON_OBJECT(), 1, 100, FALSE, 'published');
INSERT INTO mini_pet_catalog_entries
  (environment_code, pool_version, source_order, mini_pet_definition_id, definition_code,
   display_name, grade_code, grade_display_name, emoji_value, filter_key,
   raw_probability, normalized_rate, allowed)
SELECT 'dev', 'equipped-rank-v1', 1, definition.id, definition.code,
  definition.display_name, definition.grade_code, definition.grade_display_name,
  definition.emoji_value, definition.display_name, 1, 100, TRUE
FROM mini_pet_definitions definition WHERE definition.id = 900000001;
