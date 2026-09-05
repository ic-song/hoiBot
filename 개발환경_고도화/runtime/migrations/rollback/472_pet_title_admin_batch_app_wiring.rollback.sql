-- Destructive rollback: only before PET_TITLE 관리자 MODERN cutover.
-- Fail before DDL while a durable batch receipt still depends on this schema.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (
      SELECT 1 FROM canonical_app_wiring_receipt_links
      WHERE receipt_kind='PET_TITLE_BATCH'
    ) OR EXISTS (
      SELECT 1 FROM canonical_pet_title_batch_operations
    ) OR EXISTS (
      SELECT 1 FROM canonical_pet_title_batch_operation_targets
    )
  ) AS rollback_preflight
) AS rollback_preflight_guard;

ALTER TABLE IF EXISTS canonical_app_wiring_receipt_links
  DROP CONSTRAINT IF EXISTS chk_odbt_472_03_rule_02,
  DROP CONSTRAINT IF EXISTS chk_odbt_472_03_rule_01,
  DROP FOREIGN KEY IF EXISTS fk_odbt_472_03_01,
  DROP INDEX IF EXISTS uq_odbt_472_03_01,
  DROP COLUMN IF EXISTS pet_title_batch_operation_id,
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_470_02_rule_01 CHECK ((daily_prayer_operation_id IS NOT NULL) + (home_aggregate_operation_id IS NOT NULL) + (market_operation_id IS NOT NULL) + (member_title_operation_id IS NOT NULL) + (mini_pet_title_operation_id IS NOT NULL) + (package_use_operation_id IS NOT NULL) + (pet_explore_operation_id IS NOT NULL) + (pet_explore_event_control_operation_id IS NOT NULL) + (pet_title_operation_id IS NOT NULL) + (player_identity_operation_id IS NOT NULL) = 1),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_470_02_rule_02 CHECK ((receipt_kind = 'DAILY_PRAYER' AND daily_prayer_operation_id IS NOT NULL) OR (receipt_kind = 'HOME_AGGREGATE' AND home_aggregate_operation_id IS NOT NULL) OR (receipt_kind = 'MARKET' AND market_operation_id IS NOT NULL) OR (receipt_kind = 'MEMBER_TITLE' AND member_title_operation_id IS NOT NULL) OR (receipt_kind = 'MINI_PET_TITLE' AND mini_pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PACKAGE_USE' AND package_use_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE' AND pet_explore_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE_EVENT_CONTROL' AND pet_explore_event_control_operation_id IS NOT NULL) OR (receipt_kind = 'PET_TITLE' AND pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PLAYER_IDENTITY' AND player_identity_operation_id IS NOT NULL));

DROP TABLE IF EXISTS canonical_pet_title_batch_operation_targets;
DROP TABLE IF EXISTS canonical_pet_title_batch_operation_participants;
DROP TABLE IF EXISTS canonical_pet_title_batch_operations;
DROP TABLE IF EXISTS canonical_pet_title_global_locks;
