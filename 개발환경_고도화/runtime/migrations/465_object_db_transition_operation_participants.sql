-- WBS743 Gate 2 additive object DB transition provider.
-- Requires existing migrations through 460_data_migration_object_domain_import.sql.
-- CREATE TABLE IF NOT EXISTS permits safe re-entry after an unrecorded partial multi-statement run.

CREATE TABLE IF NOT EXISTS canonical_home_aggregate_operation_participants (
  home_aggregate_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  home_aggregate_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (home_aggregate_operation_participant_id),
  UNIQUE KEY uq_odbt_465_01_01 (home_aggregate_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_465_01_01 FOREIGN KEY (home_aggregate_operation_id) REFERENCES canonical_home_aggregate_operations (home_aggregate_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_465_01_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_465_01_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_01_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_01_rule_01 CHECK (participant_role IN ('HOME_OWNER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_market_operation_participants (
  market_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  market_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (market_operation_participant_id),
  UNIQUE KEY uq_odbt_465_02_01 (market_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_465_02_01 FOREIGN KEY (market_operation_id) REFERENCES canonical_market_operations (market_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_465_02_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_465_02_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_02_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_02_rule_01 CHECK (participant_role IN ('SELLER','BUYER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_member_title_operation_participants (
  member_title_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  member_title_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (member_title_operation_participant_id),
  UNIQUE KEY uq_odbt_465_03_01 (member_title_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_465_03_01 FOREIGN KEY (member_title_operation_id) REFERENCES canonical_member_title_operations (member_title_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_465_03_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_465_03_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_03_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_03_rule_01 CHECK (participant_role IN ('OWNER','RECIPIENT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_mini_pet_title_operation_participants (
  mini_pet_title_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mini_pet_title_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (mini_pet_title_operation_participant_id),
  UNIQUE KEY uq_odbt_465_04_01 (mini_pet_title_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_465_04_01 FOREIGN KEY (mini_pet_title_operation_id) REFERENCES canonical_mini_pet_title_operations (mini_pet_title_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_465_04_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_465_04_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_04_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_04_rule_01 CHECK (participant_role IN ('OWNER','RECIPIENT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_pet_title_operation_participants (
  pet_title_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_title_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_title_operation_participant_id),
  UNIQUE KEY uq_odbt_465_05_01 (pet_title_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_465_05_01 FOREIGN KEY (pet_title_operation_id) REFERENCES canonical_pet_title_operations (pet_title_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_465_05_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_465_05_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_05_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_05_rule_01 CHECK (participant_role IN ('OWNER','RECIPIENT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_player_identity_operation_participants (
  player_identity_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_identity_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_identity_operation_participant_id),
  UNIQUE KEY uq_odbt_465_06_01 (player_identity_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_465_06_01 FOREIGN KEY (player_identity_operation_id) REFERENCES canonical_player_identity_operations (player_identity_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_465_06_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_465_06_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_06_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_465_06_rule_01 CHECK (participant_role IN ('SUBJECT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

