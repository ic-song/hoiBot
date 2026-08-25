DELETE FROM command_audit WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE 'mini-pet.read:collection:%');
DELETE FROM command_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE 'mini-pet.read:collection:%');
DELETE FROM mini_pet_read_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE 'mini-pet.read:collection:%');
DELETE FROM operations WHERE idempotency_scope LIKE 'mini-pet.read:collection:%';
DELETE FROM event_inbox WHERE event_id IN ('minipet-collection-probe-v1', 'minipet-collection-empty-v1', 'minipet-collection-rollback-v1', 'minipet-collection-recovery-v1');

INSERT INTO event_inbox
  (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
VALUES
  ('minipet-collection-probe-v1', 'minipet-collection-probe-v1', 'synthetic-room-001', 'synthetic-non-admin-gamma', 'message', 'incoming', REPEAT('7', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-collection-empty-v1', 'minipet-collection-empty-v1', 'synthetic-room-001', 'synthetic-user-beta-kakao', 'message', 'incoming', REPEAT('8', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-collection-rollback-v1', 'minipet-collection-rollback-v1', 'synthetic-room-001', 'synthetic-non-admin-gamma', 'message', 'incoming', REPEAT('9', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-collection-recovery-v1', 'minipet-collection-recovery-v1', 'synthetic-room-001', 'synthetic-non-admin-gamma', 'message', 'incoming', REPEAT('a', 64), 'processed', UTC_TIMESTAMP(3));

INSERT INTO external_identities (id, player_id, provider_code, external_user_id, display_name, status)
VALUES (900000006, 900000002, 'kakao', 'synthetic-user-beta-kakao', '테스트베타', 'linked')
ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), display_name = VALUES(display_name), status = 'linked';

UPDATE castle_battle_seasons SET status = 'completed' WHERE status = 'active';

INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active) VALUES
  ('mini_pet_collection_creation', '창조 컬렉션', 'grade_creation', '창조', '🌌', TRUE),
  ('mini_pet_collection_genesis', '창세 컬렉션', 'grade_genesis', '창세', '✨', TRUE),
  ('mini_pet_collection_primordial_plus', '태초+ 컬렉션', 'grade_primordial_plus', '태초+', '🌠', TRUE),
  ('mini_pet_collection_primordial', '태초 컬렉션', 'grade_primordial', '태초', '🔥', TRUE),
  ('mini_pet_collection_transcendent_plus', '초월+ 컬렉션', 'grade_transcendent_plus', '초월+', '💫', TRUE),
  ('mini_pet_collection_transcendent', '초월 컬렉션', 'grade_transcendent', '초월', '⭐', TRUE),
  ('mini_pet_collection_myth_plus', '신화+ 컬렉션', 'grade_myth_plus', '신화+', '🌟', TRUE),
  ('mini_pet_collection_myth', '신화 컬렉션', 'grade_myth', '신화', '🐾', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code), grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = TRUE;

DELETE FROM mini_pet_catalog_entries WHERE environment_code = 'dev' AND pool_version = 'collection-v1';
DELETE FROM mini_pet_catalog_snapshots WHERE environment_code = 'dev' AND pool_version = 'collection-v1';
INSERT INTO mini_pet_catalog_snapshots
  (pool_version, environment_code, catalog_kind, definition_version, owned_snapshot_version, snapshot_at,
   grade_table_json, allowed_grades_json, stage_rewards_json, total_raw_probability, total_normalized_rate, zero_total, status)
VALUES ('collection-v1', 'dev', 'fixed_reward', 'collection-definition-v1', 'equipped-owned-v1', '2026-08-25 03:00:00.000',
  JSON_OBJECT('창조', 1, '창세', 2, '태초+', 3, '태초', 4, '초월+', 5, '초월', 6, '신화+', 7, '신화', 8),
  JSON_ARRAY('창조', '창세', '태초+', '태초', '초월+', '초월', '신화+', '신화'),
  JSON_OBJECT('1', '컬렉션 시작 보상', '2', '컬렉션 성장 보상'), 8, 100, FALSE, 'published');

INSERT INTO mini_pet_catalog_entries
  (environment_code, pool_version, source_order, mini_pet_definition_id, definition_code, display_name,
   grade_code, grade_display_name, emoji_value, filter_key, raw_probability, normalized_rate, allowed)
SELECT 'dev', 'collection-v1', seed.source_order, definition.id, definition.code, definition.display_name,
  definition.grade_code, definition.grade_display_name, definition.emoji_value, definition.display_name, 1, 12.5, TRUE
FROM (
  SELECT 1 source_order, 'mini_pet_collection_creation' code UNION ALL
  SELECT 2, 'mini_pet_collection_genesis' UNION ALL
  SELECT 3, 'mini_pet_collection_primordial_plus' UNION ALL
  SELECT 4, 'mini_pet_collection_primordial' UNION ALL
  SELECT 5, 'mini_pet_collection_transcendent_plus' UNION ALL
  SELECT 6, 'mini_pet_collection_transcendent' UNION ALL
  SELECT 7, 'mini_pet_collection_myth_plus' UNION ALL
  SELECT 8, 'mini_pet_collection_myth'
) seed JOIN mini_pet_definitions definition ON definition.code = seed.code;

DELETE projection FROM mini_pet_collection_projections projection
JOIN mini_pet_definitions definition ON definition.id = projection.mini_pet_definition_id
WHERE projection.player_id IN (900000002, 900000003) AND definition.code LIKE 'mini_pet_collection_%';
INSERT INTO mini_pet_collection_projections
  (player_id, mini_pet_definition_id, registered, stage, completed_stage, projection_version)
SELECT 900000003, definition.id,
  CASE WHEN definition.grade_display_name IN ('창조', '태초') THEN TRUE ELSE FALSE END,
  CASE WHEN definition.grade_display_name = '신화' THEN 0 ELSE 2 END, 1, 1
FROM mini_pet_definitions definition WHERE definition.code LIKE 'mini_pet_collection_%';
