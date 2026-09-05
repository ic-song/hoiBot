-- Lease2554: migration119 legacy elemental grades to migration475 canonical definition bridge.
-- The bridge is additive and never uses a display name or alias as identity.
CREATE TABLE canonical_elemental_grade_definition_bridges (
  elemental_grade_definition_bridge_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipment_grade_definition_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  elemental_grade_order INT UNSIGNED NOT NULL,
  source_identifier_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  binding_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  numeric_tuple_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  numeric_order_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bridge_manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (elemental_grade_definition_bridge_id),
  UNIQUE KEY uq_elemental_grade_bridge_definition (equipment_grade_definition_id),
  UNIQUE KEY uq_elemental_grade_bridge_order (elemental_grade_order),
  UNIQUE KEY uq_elemental_grade_bridge_source (source_identifier_sha256),
  UNIQUE KEY uq_elemental_grade_bridge_binding (binding_fingerprint),
  CONSTRAINT fk_elemental_grade_bridge_definition FOREIGN KEY (equipment_grade_definition_id)
    REFERENCES canonical_equipment_grade_definitions (equipment_grade_definition_id) ON DELETE RESTRICT,
  CONSTRAINT chk_elemental_grade_bridge_order CHECK (elemental_grade_order BETWEEN 1 AND 61),
  CONSTRAINT chk_elemental_grade_bridge_source_hash CHECK (source_identifier_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_elemental_grade_bridge_binding_hash CHECK (binding_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_elemental_grade_bridge_tuple_hash CHECK (numeric_tuple_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_elemental_grade_bridge_order_hash CHECK (numeric_order_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_elemental_grade_bridge_manifest_hash CHECK (bridge_manifest_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_elemental_grade_bridge_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_elemental_grade_bridge_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
