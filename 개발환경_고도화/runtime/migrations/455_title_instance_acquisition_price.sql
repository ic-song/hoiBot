-- WBS742: preserve the acquisition price of each member, pet, and mini-pet title occurrence.
-- Existing canonical rows predate occurrence-price persistence, so their value is unknown and remains NULL.
-- New legacy imports must write exact list[].price; never infer occurrence state from a definition price.

ALTER TABLE canonical_owned_member_title_instances
  ADD COLUMN IF NOT EXISTS acquisition_price BIGINT UNSIGNED NULL AFTER acquired_time;

ALTER TABLE canonical_owned_pet_title_instances
  ADD COLUMN IF NOT EXISTS acquisition_price BIGINT UNSIGNED NULL AFTER acquired_time;

ALTER TABLE canonical_owned_mini_pet_title_instances
  ADD COLUMN IF NOT EXISTS acquisition_price BIGINT UNSIGNED NULL AFTER acquired_time;
