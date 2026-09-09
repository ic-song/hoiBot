-- Destructive rollback: member_key_before is durable response evidence.
-- Fail before DDL while any PET_TITLE_BATCH receipt depends on the v474 contract.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (SELECT 1 FROM canonical_app_wiring_receipt_links WHERE receipt_kind='PET_TITLE_BATCH')
       OR EXISTS (SELECT 1 FROM canonical_pet_title_batch_operations)
       OR EXISTS (SELECT 1 FROM canonical_pet_title_batch_operation_targets)
  ) AS rollback_preflight
) AS rollback_preflight_guard;

ALTER TABLE canonical_pet_title_batch_operation_targets
  DROP CONSTRAINT IF EXISTS chk_odbt_474_01_member_key,
  DROP COLUMN IF EXISTS member_key_before;

ALTER TABLE canonical_pet_title_batch_operations
  DROP CONSTRAINT IF EXISTS chk_odbt_474_00_contract,
  DROP COLUMN IF EXISTS result_contract_version;
