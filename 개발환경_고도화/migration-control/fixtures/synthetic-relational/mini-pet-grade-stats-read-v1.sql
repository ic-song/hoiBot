DELETE FROM command_audit WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:grade_stats');
DELETE FROM command_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:grade_stats');
DELETE FROM mini_pet_read_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:grade_stats');
DELETE FROM operations WHERE idempotency_scope = 'mini-pet.public.read:grade_stats';
DELETE FROM event_inbox WHERE event_id IN ('minipet-stats-probe-v1', 'minipet-stats-rollback-v1', 'minipet-stats-recovery-v1');

INSERT INTO event_inbox
  (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
VALUES
  ('minipet-stats-probe-v1', 'minipet-stats-probe-v1', 'synthetic-room-001', 'synthetic-user-alpha', 'message', 'incoming', REPEAT('b', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-stats-rollback-v1', 'minipet-stats-rollback-v1', 'synthetic-room-001', 'synthetic-user-alpha', 'message', 'incoming', REPEAT('c', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-stats-recovery-v1', 'minipet-stats-recovery-v1', 'synthetic-room-001', 'synthetic-user-alpha', 'message', 'incoming', REPEAT('d', 64), 'processed', UTC_TIMESTAMP(3));

INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active) VALUES
  ('mini_pet_stats_event', '통계 이벤트', 'grade_event', '이벤트', '🎉', TRUE),
  ('mini_pet_stats_creation', '통계 창조', 'grade_creation', '창조', '🌌', TRUE),
  ('mini_pet_stats_elite_en', '통계 엘리트 EN', 'grade_elite_en', 'ELITE', '🏅', TRUE),
  ('mini_pet_stats_elite_kr', '통계 엘리트 KR', 'grade_elite_kr', '엘리트급', '🥇', TRUE),
  ('mini_pet_stats_myth', '통계 신화', 'grade_myth', '신화', '🐾', TRUE),
  ('mini_pet_stats_unknown', '통계 미정의', 'grade_unknown', '알수없음', '❓', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code), grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = TRUE;

DELETE FROM mini_pet_owned_read_snapshots WHERE environment_code = 'dev' AND snapshot_version = 'equipped-owned-v1' AND owned_mini_pet_id BETWEEN 900000041 AND 900000047;
DELETE FROM owned_mini_pets WHERE id BETWEEN 900000041 AND 900000047;

INSERT INTO owned_mini_pets
  (id, player_id, mini_pet_definition_id, custom_name, progress, enhancement_level, battle_experience, castle_experience, raid_experience, equipped)
SELECT seed.id, 900000001, definition.id, definition.display_name, 0, 0, seed.exp, 0, 0, seed.equipped
FROM (
  SELECT 900000041 id, 'mini_pet_stats_event' code, 60 exp, FALSE equipped UNION ALL
  SELECT 900000042, 'mini_pet_stats_creation', 50, FALSE UNION ALL
  SELECT 900000043, 'mini_pet_stats_elite_en', 40, FALSE UNION ALL
  SELECT 900000044, 'mini_pet_stats_elite_kr', 30, FALSE UNION ALL
  SELECT 900000045, 'mini_pet_stats_myth', 20, FALSE UNION ALL
  SELECT 900000046, 'mini_pet_stats_unknown', 10, FALSE UNION ALL
  SELECT 900000047, 'mini_pet_stats_elite_en', 100, TRUE
) seed JOIN mini_pet_definitions definition ON definition.code = seed.code;

INSERT INTO mini_pet_owned_read_snapshots
  (environment_code, snapshot_version, owned_mini_pet_id, player_id, mini_pet_definition_id, custom_name, battle_experience, equipped)
SELECT 'dev', 'equipped-owned-v1', owned.id, owned.player_id, owned.mini_pet_definition_id, owned.custom_name, owned.battle_experience, owned.equipped
FROM owned_mini_pets owned WHERE owned.id BETWEEN 900000041 AND 900000047;
