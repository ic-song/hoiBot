ALTER TABLE mini_pet_definitions
  ADD COLUMN grade_display_name VARCHAR(191) NULL AFTER grade_code,
  ADD COLUMN emoji_value VARCHAR(191) NULL AFTER grade_display_name;

ALTER TABLE owned_mini_pets
  ADD COLUMN battle_experience BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER progress,
  ADD COLUMN castle_experience BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER battle_experience,
  ADD COLUMN raid_experience BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER castle_experience;
