START TRANSACTION;

DELETE event_row
FROM support_pass_change_events event_row
JOIN operations operation_row ON operation_row.id=event_row.operation_id
WHERE operation_row.idempotency_scope='migration.411.pass.canonical.backfill';

DELETE canonical_row
FROM player_support_passes canonical_row
JOIN operations operation_row ON operation_row.id=canonical_row.created_operation_id
WHERE operation_row.idempotency_scope='migration.411.pass.canonical.backfill'
  AND canonical_row.updated_operation_id=canonical_row.created_operation_id;

DELETE operation_row
FROM operations operation_row
LEFT JOIN player_support_passes canonical_row
  ON canonical_row.created_operation_id=operation_row.id OR canonical_row.updated_operation_id=operation_row.id
LEFT JOIN support_pass_change_events event_row ON event_row.operation_id=operation_row.id
WHERE operation_row.idempotency_scope='migration.411.pass.canonical.backfill'
  AND canonical_row.id IS NULL
  AND event_row.operation_id IS NULL;

DELETE definition_row
FROM support_pass_definitions definition_row
LEFT JOIN player_support_passes canonical_row ON canonical_row.pass_code=definition_row.pass_code
WHERE definition_row.pass_code IN ('hoi','newbie','premium')
  AND canonical_row.id IS NULL;

UPDATE support_pass_definitions SET display_name='공헌패스' WHERE pass_code='contribution';
UPDATE support_pass_definitions SET display_name='다이아패스' WHERE pass_code='diamond';
UPDATE support_pass_definitions SET display_name='원데이패스' WHERE pass_code='oneday';

COMMIT;
