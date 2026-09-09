SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO support_pass_definitions(pass_code,display_name,active) VALUES
('contribution','길드공헌패스🎖️',TRUE),
('diamond','다이아패스💎',TRUE),
('oneday','원데이패스🎲',TRUE),
('hoi','호이패스🐶',TRUE),
('newbie','초보패스🐥',TRUE),
('premium','호이패스 프리미엄👑',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;

INSERT INTO operations(
  operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,result_json,
  created_at,completed_at
)
SELECT UUID(),'migration.411.pass.canonical.backfill',
       CONCAT(legacy_row.player_id,'|',legacy_row.pass_code),
       'migration',NULL,'migration411','completed',
       JSON_OBJECT('compatibilityCode',legacy_row.pass_code,'canonicalCode',
         CASE legacy_row.pass_code WHEN 'support' THEN 'hoi' WHEN 'beginner' THEN 'newbie' ELSE 'premium' END),
       UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
FROM player_passes legacy_row
WHERE legacy_row.pass_code IN ('support','beginner','premium')
ON DUPLICATE KEY UPDATE idempotency_scope=VALUES(idempotency_scope);

INSERT INTO player_support_passes(
  player_id,pass_code,entitlement_kind,end_date,status,version,
  created_operation_id,updated_operation_id,created_at,updated_at
)
SELECT legacy_row.player_id,
       CASE legacy_row.pass_code WHEN 'support' THEN 'hoi' WHEN 'beginner' THEN 'newbie' ELSE 'premium' END,
       CASE WHEN legacy_row.permanent=TRUE OR legacy_row.ends_at IS NULL THEN 'permanent' ELSE 'dated' END,
       CASE WHEN legacy_row.permanent=TRUE OR legacy_row.ends_at IS NULL THEN NULL ELSE DATE(legacy_row.ends_at) END,
       CASE
         WHEN legacy_row.enabled=FALSE THEN 'revoked'
         WHEN legacy_row.permanent=FALSE AND legacy_row.ends_at IS NOT NULL AND DATE(legacy_row.ends_at)<UTC_DATE() THEN 'expired'
         ELSE 'active'
       END,
       1,operation_row.id,operation_row.id,
       COALESCE(legacy_row.starts_at,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3)
FROM player_passes legacy_row
JOIN operations operation_row
  ON operation_row.idempotency_scope='migration.411.pass.canonical.backfill'
 AND operation_row.idempotency_key=CONCAT(legacy_row.player_id,'|',legacy_row.pass_code)
WHERE legacy_row.pass_code IN ('support','beginner','premium')
ON DUPLICATE KEY UPDATE pass_code=VALUES(pass_code);

COMMIT;
