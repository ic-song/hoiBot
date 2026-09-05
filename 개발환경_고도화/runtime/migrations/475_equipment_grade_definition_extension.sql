-- WBS725 Lease2551: lossless itemInfo elemental/ring grade definitions.
-- Additive only: migration 446 equipment definition and ownership semantics stay unchanged.
CREATE TABLE canonical_equipment_grade_definitions (
  equipment_grade_definition_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_definition_pointer VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  equipment_family VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_grade_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  equipment_grade_emoji VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  enhancement_success_probability DECIMAL(31,30) NOT NULL,
  enhancement_drop_probability DECIMAL(31,30) NOT NULL,
  item_cost_quantity DECIMAL(65,0) NOT NULL,
  point_cost_amount DECIMAL(65,0) NOT NULL,
  maximum_enhancement_level DECIMAL(65,0) NOT NULL,
  battle_base_experience_amount DECIMAL(65,0) NOT NULL,
  battle_experience_per_enhancement_amount DECIMAL(65,0) NOT NULL,
  raid_base_experience_amount DECIMAL(65,0) NOT NULL,
  raid_experience_per_enhancement_amount DECIMAL(65,0) NOT NULL,
  castle_base_experience_amount DECIMAL(65,0) NOT NULL,
  castle_experience_per_enhancement_amount DECIMAL(65,0) NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (equipment_grade_definition_id),
  UNIQUE KEY uq_equipment_grade_source_pointer (source_definition_pointer),
  CONSTRAINT chk_equipment_grade_source_pointer CHECK (
    (equipment_family = 'elemental' AND source_definition_pointer LIKE '/elemental/%') OR
    (equipment_family = 'ring' AND source_definition_pointer LIKE '/ring/%')
  ),
  CONSTRAINT chk_equipment_grade_name CHECK (CHAR_LENGTH(equipment_grade_name) BETWEEN 1 AND 255),
  CONSTRAINT chk_equipment_grade_emoji CHECK (CHAR_LENGTH(equipment_grade_emoji) BETWEEN 1 AND 32),
  CONSTRAINT chk_equipment_grade_success_probability CHECK (enhancement_success_probability BETWEEN 0 AND 1),
  CONSTRAINT chk_equipment_grade_drop_probability CHECK (enhancement_drop_probability BETWEEN 0 AND 1),
  CONSTRAINT chk_equipment_grade_nonnegative_values CHECK (
    item_cost_quantity >= 0 AND point_cost_amount >= 0 AND maximum_enhancement_level >= 0 AND
    battle_base_experience_amount >= 0 AND battle_experience_per_enhancement_amount >= 0 AND
    raid_base_experience_amount >= 0 AND raid_experience_per_enhancement_amount >= 0 AND
    castle_base_experience_amount >= 0 AND castle_experience_per_enhancement_amount >= 0
  ),
  CONSTRAINT chk_equipment_grade_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_equipment_grade_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_equipment_grade_aliases (
  equipment_grade_alias_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_grade_definition_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alias_order INT UNSIGNED NOT NULL,
  equipment_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (equipment_grade_alias_id),
  UNIQUE KEY uq_equipment_grade_alias_order (equipment_grade_definition_id, alias_order),
  KEY idx_equipment_grade_alias_name (equipment_name),
  CONSTRAINT fk_equipment_grade_alias_definition FOREIGN KEY (equipment_grade_definition_id)
    REFERENCES canonical_equipment_grade_definitions (equipment_grade_definition_id) ON DELETE RESTRICT,
  CONSTRAINT chk_equipment_grade_alias_name CHECK (CHAR_LENGTH(equipment_name) BETWEEN 1 AND 255),
  CONSTRAINT chk_equipment_grade_alias_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_equipment_grade_alias_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
