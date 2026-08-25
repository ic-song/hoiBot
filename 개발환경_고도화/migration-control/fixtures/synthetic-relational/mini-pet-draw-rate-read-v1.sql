SET NAMES utf8mb4;

DELETE FROM outbox_messages WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:draw_rates'
    AND idempotency_key IN ('minipet-draw-rate-probe-v1', 'minipet-draw-rate-rollback-v1')
);
DELETE FROM command_audit WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:draw_rates'
    AND idempotency_key IN ('minipet-draw-rate-probe-v1', 'minipet-draw-rate-rollback-v1')
);
DELETE FROM command_executions WHERE event_id IN ('minipet-draw-rate-probe-v1', 'minipet-draw-rate-rollback-v1');
DELETE FROM mini_pet_read_executions WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.public.read:draw_rates'
    AND idempotency_key IN ('minipet-draw-rate-probe-v1', 'minipet-draw-rate-rollback-v1')
);
DELETE FROM operations WHERE idempotency_scope = 'mini-pet.public.read:draw_rates'
  AND idempotency_key IN ('minipet-draw-rate-probe-v1', 'minipet-draw-rate-rollback-v1');
DELETE FROM event_inbox WHERE event_id IN ('minipet-draw-rate-probe-v1', 'minipet-draw-rate-rollback-v1');

INSERT INTO event_inbox
  (event_id, provider_code, provider_event_id, event_kind, processing_status, received_at, processed_at, attempt_count)
VALUES
  ('minipet-draw-rate-probe-v1', 'iris', 'minipet-draw-rate-probe-v1', 'message', 'processed', '2026-08-25 04:10:00.000', '2026-08-25 04:10:00.000', 1),
  ('minipet-draw-rate-rollback-v1', 'iris', 'minipet-draw-rate-rollback-v1', 'message', 'processed', '2026-08-25 04:11:00.000', '2026-08-25 04:11:00.000', 1);

DELETE FROM mini_pet_catalog_entries WHERE environment_code = 'dev' AND pool_version = 'draw-rate-v1';
DELETE FROM mini_pet_catalog_snapshots WHERE environment_code = 'dev' AND pool_version = 'draw-rate-v1';

INSERT INTO mini_pet_owned_snapshot_versions (environment_code, snapshot_version, captured_at)
VALUES ('dev', 'draw-owned-v1', '2026-08-25 04:00:00.000')
ON DUPLICATE KEY UPDATE captured_at = VALUES(captured_at);

INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active) VALUES
  ('draw_rate_normal', '일반', 'normal', '일반', '🐹', TRUE),
  ('draw_rate_advanced', '고급', 'advanced', '고급', '🐹', TRUE),
  ('draw_rate_rare', '희귀', 'rare', '희귀', '🐹', TRUE),
  ('draw_rate_hero', '영웅', 'hero', '영웅', '🐹', TRUE),
  ('draw_rate_legend', '전설', 'legend', '전설', '🐹', TRUE),
  ('draw_rate_legend_plus', '전설+', 'legend_plus', '전설+', '🐹', TRUE),
  ('draw_rate_event_denied', '이벤트', 'event', '이벤트', '🐹', TRUE),
  ('draw_rate_myth', '신화', 'myth', '신화', '🐹', TRUE),
  ('draw_rate_myth_plus', '신화+', 'myth_plus', '신화+', '🐹', TRUE),
  ('draw_rate_transcend', '초월', 'transcend', '초월', '🐹', TRUE),
  ('draw_rate_transcend_plus', '초월+', 'transcend_plus', '초월+', '🐹', TRUE),
  ('draw_rate_origin', '태초', 'origin', '태초', '🐹', TRUE),
  ('draw_rate_origin_plus', '태초+', 'origin_plus', '태초+', '🐹', TRUE),
  ('draw_rate_genesis', '창세', 'genesis', '창세', '🐹', TRUE),
  ('draw_rate_creation', '창조', 'creation', '창조', '🐹', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = TRUE;

INSERT INTO mini_pet_catalog_snapshots
  (pool_version, environment_code, catalog_kind, definition_version, owned_snapshot_version, snapshot_at,
   grade_table_json, allowed_grades_json, stage_rewards_json, total_raw_probability, total_normalized_rate, zero_total, status)
VALUES
  ('draw-rate-v1', 'dev', 'draw_rate', 'draw-definition-v1', 'draw-owned-v1', '2026-08-25 04:00:00.000',
   JSON_OBJECT('source', 'synthetic-current-gradeTable-v1'),
   JSON_ARRAY('일반','고급','희귀','영웅','전설','전설+','신화','신화+','초월','초월+','태초','태초+','창세','창조'),
   JSON_OBJECT(), 100.00000000, 100.0000, FALSE, 'published');

INSERT INTO mini_pet_catalog_entries
  (environment_code, pool_version, source_order, mini_pet_definition_id, definition_code, display_name,
   grade_code, grade_display_name, emoji_value, filter_key, raw_probability, normalized_rate, allowed)
SELECT 'dev', 'draw-rate-v1', source_order, definition.id, definition.code, definition.display_name,
  definition.grade_code, definition.grade_display_name, definition.emoji_value, definition.display_name,
  raw_probability, normalized_rate, allowed
FROM (
  SELECT 1 source_order, 'draw_rate_normal' code, 50.0 raw_probability, 50.0 normalized_rate, TRUE allowed UNION ALL
  SELECT 2, 'draw_rate_advanced', 20.0, 20.0, TRUE UNION ALL
  SELECT 3, 'draw_rate_rare', 10.0, 10.0, TRUE UNION ALL
  SELECT 4, 'draw_rate_hero', 8.0, 8.0, TRUE UNION ALL
  SELECT 5, 'draw_rate_legend', 5.0, 5.0, TRUE UNION ALL
  SELECT 6, 'draw_rate_legend_plus', 2.0, 2.0, TRUE UNION ALL
  SELECT 7, 'draw_rate_event_denied', 999.0, 999.0, FALSE UNION ALL
  SELECT 8, 'draw_rate_myth', 1.5, 1.5, TRUE UNION ALL
  SELECT 9, 'draw_rate_myth_plus', 1.0, 1.0, TRUE UNION ALL
  SELECT 10, 'draw_rate_transcend', 1.0, 1.0, TRUE UNION ALL
  SELECT 11, 'draw_rate_transcend_plus', 0.5, 0.5, TRUE UNION ALL
  SELECT 12, 'draw_rate_origin', 0.4, 0.4, TRUE UNION ALL
  SELECT 13, 'draw_rate_origin_plus', 0.3, 0.3, TRUE UNION ALL
  SELECT 14, 'draw_rate_genesis', 0.2, 0.2, TRUE UNION ALL
  SELECT 15, 'draw_rate_creation', 0.1, 0.1, TRUE
) input
JOIN mini_pet_definitions definition ON definition.code = input.code;
