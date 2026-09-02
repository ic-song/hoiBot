-- WBS731 공용 identity/audit provider: 신규 표준 대상만 추가합니다.
CREATE TABLE IF NOT EXISTS object_identities (
  object_identity_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_type VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (object_identity_id),
  CONSTRAINT chk_object_identities_type CHECK (object_type REGEXP '^[A-Z][A-Z0-9_]{0,49}$'),
  CONSTRAINT chk_object_identities_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  CONSTRAINT chk_object_identities_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS object_identity_crosswalks (
  object_identity_crosswalk_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_identity_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_identifier VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (object_identity_crosswalk_id),
  UNIQUE KEY uq_object_identity_crosswalk_source (source_system, source_namespace, source_identifier),
  KEY idx_object_identity_crosswalk_target (object_identity_id),
  CONSTRAINT fk_object_identity_crosswalk_target FOREIGN KEY (object_identity_id)
    REFERENCES object_identities (object_identity_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_identity_crosswalks_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  CONSTRAINT chk_object_identity_crosswalks_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
