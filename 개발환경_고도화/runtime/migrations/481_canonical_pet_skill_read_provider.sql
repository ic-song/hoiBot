-- WBS757: canonical pet-skill read metadata and deterministic alias/draw-policy boundary.
ALTER TABLE canonical_pet_skill_definitions
  ADD COLUMN legacy_source_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER pet_skill_grade,
  ADD COLUMN display_order INT UNSIGNED NULL AFTER legacy_source_key,
  ADD COLUMN base_draw_rate DECIMAL(9,6) NULL AFTER display_order,
  ADD COLUMN fixed_draw_rate_flag BOOLEAN NULL AFTER base_draw_rate,
  ADD COLUMN openable_flag BOOLEAN NULL AFTER fixed_draw_rate_flag,
  ADD COLUMN pet_skill_grade_emoji VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER openable_flag,
  ADD COLUMN required_tier_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER pet_skill_grade_emoji,
  ADD COLUMN tier_exclusive_flag BOOLEAN NULL AFTER required_tier_name,
  ADD COLUMN equip_description TEXT NULL AFTER tier_exclusive_flag,
  ADD UNIQUE KEY uq_canonical_pet_skill_legacy_source_key (legacy_source_key),
  ADD UNIQUE KEY uq_canonical_pet_skill_display_order (display_order),
  ADD CONSTRAINT chk_canonical_pet_skill_legacy_source_key CHECK (legacy_source_key IS NULL OR legacy_source_key REGEXP '^skill_[0-9]{3,}$'),
  ADD CONSTRAINT chk_canonical_pet_skill_display_order CHECK (display_order IS NULL OR display_order >= 1),
  ADD CONSTRAINT chk_canonical_pet_skill_base_draw_rate CHECK (base_draw_rate IS NULL OR (base_draw_rate >= 0 AND base_draw_rate <= 100)),
  ADD CONSTRAINT chk_canonical_pet_skill_tier_metadata CHECK ((tier_exclusive_flag IS NULL) OR (tier_exclusive_flag=FALSE AND required_tier_name IS NULL) OR (tier_exclusive_flag=TRUE AND required_tier_name IS NOT NULL));

CREATE TABLE canonical_pet_skill_aliases (
  pet_skill_alias_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alias_type VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alias_value VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  normalized_alias_value VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_skill_alias_id),
  UNIQUE KEY uq_canonical_pet_skill_alias_identity (alias_type, normalized_alias_value),
  UNIQUE KEY uq_canonical_pet_skill_alias_value (pet_skill_id, alias_type, alias_value),
  CONSTRAINT fk_canonical_pet_skill_alias_definition FOREIGN KEY (pet_skill_id) REFERENCES canonical_pet_skill_definitions (pet_skill_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_pet_skill_alias_type CHECK (alias_type IN ('legacy_name','display_name','command_lookup')),
  CONSTRAINT chk_canonical_pet_skill_alias_value CHECK (CHAR_LENGTH(alias_value)>0 AND CHAR_LENGTH(normalized_alias_value)>0),
  CONSTRAINT chk_canonical_pet_skill_aliases_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_skill_aliases_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_pet_skill_draw_grade_policies (
  pet_skill_draw_grade_policy_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_skill_grade VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_probability_total DECIMAL(9,6) NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_skill_draw_grade_policy_id),
  UNIQUE KEY uq_canonical_pet_skill_draw_grade (pet_skill_grade),
  UNIQUE KEY uq_canonical_pet_skill_draw_order (display_order),
  CONSTRAINT chk_canonical_pet_skill_draw_grade_name CHECK (CHAR_LENGTH(TRIM(pet_skill_grade)) > 0),
  CONSTRAINT chk_canonical_pet_skill_draw_grade_total CHECK (grade_probability_total >= 0 AND grade_probability_total <= 100),
  CONSTRAINT chk_canonical_pet_skill_draw_grade_order CHECK (display_order >= 1),
  CONSTRAINT chk_canonical_pet_skill_draw_grade_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_skill_draw_grade_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE canonical_owned_pet_skill_equipments
  DROP CONSTRAINT chk_canonical_pet_skill_equipment_slot,
  ADD CONSTRAINT chk_canonical_pet_skill_equipment_slot CHECK (slot_number BETWEEN 1 AND 40);
