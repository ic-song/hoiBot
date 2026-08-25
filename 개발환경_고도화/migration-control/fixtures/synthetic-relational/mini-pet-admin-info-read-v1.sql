DELETE FROM outbox_messages WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.read:admin_info:900000004');
DELETE FROM command_audit WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.read:admin_info:900000004');
DELETE FROM command_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.read:admin_info:900000004');
DELETE FROM mini_pet_read_executions WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope = 'mini-pet.read:admin_info:900000004');
DELETE FROM operations WHERE idempotency_scope = 'mini-pet.read:admin_info:900000004';
DELETE FROM event_inbox WHERE event_id IN ('minipet-admin-probe-v1', 'minipet-admin-rollback-v1', 'minipet-admin-recovery-v1');

INSERT INTO event_inbox
  (event_id, provider_event_id, external_channel_id, external_user_id, event_kind,
   direction, payload_hash, processing_status, received_at)
VALUES
  ('minipet-admin-probe-v1', 'minipet-admin-probe-v1', 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('4', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-admin-rollback-v1', 'minipet-admin-rollback-v1', 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('5', 64), 'processed', UTC_TIMESTAMP(3)),
  ('minipet-admin-recovery-v1', 'minipet-admin-recovery-v1', 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('6', 64), 'processed', UTC_TIMESTAMP(3));

INSERT INTO mini_pet_trusted_admin_identities
  (external_identity_id, environment_code, approved_by_operator_id, status, approved_at, revoked_at)
VALUES (900000004, 'dev', 900000001, 'active', UTC_TIMESTAMP(3), NULL)
ON DUPLICATE KEY UPDATE approved_by_operator_id = VALUES(approved_by_operator_id), status = 'active', revoked_at = NULL;

INSERT INTO mini_pet_admin_read_channel_scopes
  (environment_code, external_channel_id, approved_by_operator_id, status, approved_at, revoked_at)
VALUES ('dev', 'synthetic-room-001', 900000001, 'active', UTC_TIMESTAMP(3), NULL)
ON DUPLICATE KEY UPDATE approved_by_operator_id = VALUES(approved_by_operator_id), status = 'active', revoked_at = NULL;

DELETE FROM mini_pet_admin_legacy_snapshot_fields
WHERE environment_code = 'dev' AND snapshot_version = 'equipped-owned-v1' AND player_id = 900000002;
INSERT INTO mini_pet_admin_legacy_snapshot_fields
  (environment_code, snapshot_version, player_id, field_code, field_value_json, captured_at)
VALUES
  ('dev', 'equipped-owned-v1', 900000002, 'profile', JSON_QUOTE('칭호: 합성 베타\n매력: 12'), '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000002, 'collection', JSON_QUOTE('도감: 1/1'), '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000002, 'draw', JSON_QUOTE('뽑기권: 3개'), '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000002, 'equipped', JSON_QUOTE('🔥합성베타 | EXP 100'), '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000002, 'battle', JSON_QUOTE('전투 경험치: 100'), '2026-08-25 02:00:00.000'),
  ('dev', 'equipped-owned-v1', 900000002, 'bag', JSON_QUOTE('가방 1. 합성베타'), '2026-08-25 02:00:00.000');
