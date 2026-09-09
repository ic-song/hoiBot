-- Destructive rollback: removes mini-pet display overrides and the owned-object lifecycle checks.
ALTER TABLE canonical_owned_equipment_instances
  DROP CONSTRAINT chk_canonical_owned_equipment_status;

ALTER TABLE canonical_owned_pet_instances
  DROP CONSTRAINT chk_canonical_owned_pet_status;

ALTER TABLE canonical_owned_item_instances
  DROP CONSTRAINT chk_canonical_owned_item_instance_status;

ALTER TABLE canonical_owned_mini_pet_instances
  DROP COLUMN IF EXISTS custom_emoji,
  DROP COLUMN IF EXISTS custom_name;
