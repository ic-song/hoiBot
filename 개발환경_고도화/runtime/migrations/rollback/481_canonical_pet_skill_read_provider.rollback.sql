-- Fail closed instead of applying an invalid <=30 CHECK over live slot 31..40 rows.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2 WHERE EXISTS (
      SELECT 1 FROM canonical_owned_pet_skill_equipments WHERE slot_number BETWEEN 31 AND 40
    )
  ) AS rollback_preflight
) AS rollback_preflight_guard;

ALTER TABLE canonical_owned_pet_skill_equipments
  DROP CONSTRAINT chk_canonical_pet_skill_equipment_slot,
  ADD CONSTRAINT chk_canonical_pet_skill_equipment_slot CHECK (slot_number BETWEEN 1 AND 30);

DROP TABLE IF EXISTS canonical_pet_skill_draw_grade_policies;
DROP TABLE IF EXISTS canonical_pet_skill_aliases;

ALTER TABLE canonical_pet_skill_definitions
  DROP CONSTRAINT chk_canonical_pet_skill_tier_metadata,
  DROP CONSTRAINT chk_canonical_pet_skill_base_draw_rate,
  DROP CONSTRAINT chk_canonical_pet_skill_display_order,
  DROP CONSTRAINT chk_canonical_pet_skill_legacy_source_key,
  DROP INDEX uq_canonical_pet_skill_display_order,
  DROP INDEX uq_canonical_pet_skill_legacy_source_key,
  DROP COLUMN equip_description,
  DROP COLUMN tier_exclusive_flag,
  DROP COLUMN required_tier_name,
  DROP COLUMN pet_skill_grade_emoji,
  DROP COLUMN openable_flag,
  DROP COLUMN fixed_draw_rate_flag,
  DROP COLUMN base_draw_rate,
  DROP COLUMN display_order,
  DROP COLUMN legacy_source_key;
