-- Destructive rollback: use only before cutover or after confirming acquisition prices are dispensable.
ALTER TABLE canonical_owned_mini_pet_title_instances
  DROP COLUMN IF EXISTS acquisition_price;

ALTER TABLE canonical_owned_pet_title_instances
  DROP COLUMN IF EXISTS acquisition_price;

ALTER TABLE canonical_owned_member_title_instances
  DROP COLUMN IF EXISTS acquisition_price;
