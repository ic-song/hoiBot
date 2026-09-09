-- WBS743 Gate 2 additive object DB transition provider.
-- Requires existing migrations through 460_data_migration_object_domain_import.sql.
-- CREATE TABLE IF NOT EXISTS permits safe re-entry after an unrecorded partial multi-statement run.

CREATE TABLE IF NOT EXISTS canonical_player_identity_crosswalks (
  canonical_player_identity_crosswalk_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_user_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  crosswalk_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (canonical_player_identity_crosswalk_id),
  UNIQUE KEY uq_odbt_461_01_01 (provider_code, external_user_id),
  CONSTRAINT fk_odbt_461_01_01 FOREIGN KEY (provider_code, external_user_id) REFERENCES external_identities (provider_code, external_user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_461_01_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_461_01_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_461_01_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_461_01_rule_01 CHECK (crosswalk_status IN ('LINKED','REVOKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

