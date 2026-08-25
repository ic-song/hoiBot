SET NAMES utf8mb4;

DELETE FROM outbox_messages WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%'
    AND idempotency_key IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1')
);
DELETE FROM command_audit WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%'
    AND idempotency_key IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1')
);
DELETE FROM admin_adjustment_ledger WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%'
    AND idempotency_key IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1')
);
DELETE FROM inventory_ledger WHERE operation_id IN (
  SELECT id FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%'
    AND idempotency_key IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1')
);
DELETE FROM command_executions WHERE event_id IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1');
DELETE FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%'
  AND idempotency_key IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1');
DELETE FROM event_inbox WHERE event_id IN ('admin-minipet-draw-grant-probe-v1', 'admin-minipet-draw-grant-rollback-v1');

UPDATE admin_operators SET display_name = '호이 남', status = 'active' WHERE id = 900000001;
INSERT INTO external_identities (id, player_id, provider_code, external_user_id, display_name, status)
VALUES (900000006, 900000002, 'kakao', 'synthetic-admin-beta', '합성부방', 'linked')
ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), display_name = VALUES(display_name), status = VALUES(status);
INSERT INTO admin_operators (id, login_id, display_name, password_hash, status)
VALUES (900000002, 'synthetic-admin-beta', '합성 부방', 'synthetic-disabled-password-hash-not-valid-for-login', 'active')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash), status = VALUES(status);
INSERT INTO admin_operator_roles (operator_id, role_id)
SELECT 900000002, role.id FROM admin_roles role WHERE role.code = 'super_admin'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
INSERT INTO admin_operator_external_identities (operator_id, external_identity_id)
VALUES (900000002, 900000006)
ON DUPLICATE KEY UPDATE operator_id = VALUES(operator_id);

INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
SELECT target.player_id, item.id, target.quantity, 1
FROM (
  SELECT 900000001 player_id, 10 quantity UNION ALL SELECT 900000002, 20
) target
JOIN item_definitions item ON item.code = 'bag_3241894752b82f7a'
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = inventory_stacks.version + 1;

INSERT INTO event_inbox
  (event_id, provider_code, provider_event_id, event_kind, processing_status, received_at, processed_at, attempt_count)
VALUES
  ('admin-minipet-draw-grant-probe-v1', 'iris', 'admin-minipet-draw-grant-probe-v1', 'message', 'processed', '2026-08-25 05:00:00.000', '2026-08-25 05:00:00.000', 1);
