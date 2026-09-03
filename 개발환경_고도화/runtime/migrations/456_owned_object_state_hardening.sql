-- WBS742: preserve confirmed per-instance mini-pet display overrides and constrain owned-object lifecycle states.
-- Definition binding must be resolved before custom_name/custom_emoji are populated; unresolved legacy
-- occurrences remain quarantined rather than being matched by mutable display or charm fields.

ALTER TABLE canonical_owned_mini_pet_instances
  ADD COLUMN IF NOT EXISTS custom_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER mini_pet_id;

ALTER TABLE canonical_owned_mini_pet_instances
  ADD COLUMN IF NOT EXISTS custom_emoji VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER custom_name;

ALTER TABLE canonical_owned_item_instances
  ADD CONSTRAINT chk_canonical_owned_item_instance_status
  CHECK (ownership_status IN ('owned','listed','consumed','removed'));

ALTER TABLE canonical_owned_pet_instances
  ADD CONSTRAINT chk_canonical_owned_pet_status
  CHECK (ownership_status IN ('owned','listed','consumed','removed'));

ALTER TABLE canonical_owned_equipment_instances
  ADD CONSTRAINT chk_canonical_owned_equipment_status
  CHECK (ownership_status IN ('owned','listed','consumed','removed'));
