-- Destructive rollback: only before PET_TITLE_SELL MODERN cutover.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (
      SELECT 1 FROM canonical_pet_title_operations
      WHERE operation_type='SELL' OR currency_operation_id IS NOT NULL
    )
  ) AS rollback_preflight
) AS rollback_preflight_guard;

DELETE FROM command_aliases WHERE command_text='/펫타이틀판매 [번호]' AND command_code='PET_TITLE_SELL';
DELETE FROM command_registry WHERE command_code='PET_TITLE_SELL' AND handler_key='pet_title_lifecycle';

ALTER TABLE canonical_pet_title_operations
  DROP FOREIGN KEY IF EXISTS fk_odbt_471_01_01,
  DROP INDEX IF EXISTS uq_odbt_471_01_01,
  DROP COLUMN IF EXISTS currency_operation_id;

ALTER TABLE canonical_currency_operations
  DROP INDEX IF EXISTS uq_odbt_471_00_01;
