-- WBS743 R4: PET_TITLE 관리자 지급과 전역 동기화/초기화 typed receipt.

CREATE TABLE IF NOT EXISTS canonical_pet_title_global_locks (
  pet_title_global_lock_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lock_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lock_version BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_title_global_lock_id),
  UNIQUE KEY uq_odbt_472_00_01 (lock_key),
  CONSTRAINT chk_odbt_472_00_rule_01 CHECK (lock_key='PET_TITLE'),
  CONSTRAINT chk_odbt_472_00_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_472_00_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO canonical_pet_title_global_locks(pet_title_global_lock_id,lock_key,lock_version,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
VALUES ('ptlock01','PET_TITLE',1,'migration_472',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'),'migration_472',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'))
ON DUPLICATE KEY UPDATE lock_key=VALUES(lock_key);

CREATE TABLE IF NOT EXISTS canonical_pet_title_batch_operations (
  pet_title_batch_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replay_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affected_player_count BIGINT UNSIGNED NOT NULL,
  affected_title_count BIGINT UNSIGNED NOT NULL,
  target_count BIGINT UNSIGNED NOT NULL,
  target_set_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_title_batch_operation_id),
  UNIQUE KEY uq_odbt_472_01_01 (replay_namespace, request_key),
  CONSTRAINT chk_odbt_472_01_rule_01 CHECK (operation_type IN ('ADMIN_SYNC','ADMIN_RESET')),
  CONSTRAINT chk_odbt_472_01_rule_02 CHECK (operation_status IN ('COMPLETED','FAILED')),
  CONSTRAINT chk_odbt_472_01_rule_03 CHECK (payload_fingerprint REGEXP '^[0-9a-f]{64}$' AND target_set_fingerprint REGEXP '^[0-9a-f]{64}$' AND result_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_472_01_rule_04 CHECK (target_count=affected_title_count),
  CONSTRAINT chk_odbt_472_01_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_472_01_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_pet_title_batch_operation_targets (
  pet_title_batch_operation_target_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_title_batch_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acquisition_sequence BIGINT UNSIGNED NOT NULL,
  ownership_status_before VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_status_before VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ownership_status_after VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_title_batch_operation_target_id),
  UNIQUE KEY uq_odbt_472_04_01 (pet_title_batch_operation_id, owned_pet_title_id),
  CONSTRAINT fk_odbt_472_04_01 FOREIGN KEY (pet_title_batch_operation_id) REFERENCES canonical_pet_title_batch_operations (pet_title_batch_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_472_04_02 FOREIGN KEY (owned_pet_title_id, player_id) REFERENCES canonical_owned_pet_title_instances (owned_pet_title_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_472_04_rule_01 CHECK (ownership_status_before='owned' AND ownership_status_after='removed'),
  CONSTRAINT chk_odbt_472_04_rule_02 CHECK (selection_status_before IN ('SELECTED','NOT_SELECTED') AND action_type='SOFT_REMOVE'),
  CONSTRAINT chk_odbt_472_04_rule_03 CHECK (acquisition_sequence > 0),
  CONSTRAINT chk_odbt_472_04_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_472_04_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_pet_title_batch_operation_participants (
  pet_title_batch_operation_participant_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_title_batch_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affected_title_count BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_title_batch_operation_participant_id),
  UNIQUE KEY uq_odbt_472_02_01 (pet_title_batch_operation_id, player_id, participant_role),
  CONSTRAINT fk_odbt_472_02_01 FOREIGN KEY (pet_title_batch_operation_id) REFERENCES canonical_pet_title_batch_operations (pet_title_batch_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_472_02_02 FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_472_02_rule_01 CHECK (participant_role='AFFECTED_OWNER'),
  CONSTRAINT chk_odbt_472_02_rule_02 CHECK (affected_title_count > 0),
  CONSTRAINT chk_odbt_472_02_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_472_02_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE canonical_app_wiring_receipt_links
  DROP CONSTRAINT IF EXISTS chk_odbt_470_02_rule_01,
  DROP CONSTRAINT IF EXISTS chk_odbt_470_02_rule_02,
  ADD COLUMN IF NOT EXISTS pet_title_batch_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER pet_title_operation_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_odbt_472_03_01 (pet_title_batch_operation_id),
  ADD CONSTRAINT fk_odbt_472_03_01 FOREIGN KEY IF NOT EXISTS (pet_title_batch_operation_id) REFERENCES canonical_pet_title_batch_operations (pet_title_batch_operation_id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_odbt_472_03_rule_01 CHECK ((daily_prayer_operation_id IS NOT NULL) + (home_aggregate_operation_id IS NOT NULL) + (market_operation_id IS NOT NULL) + (member_title_operation_id IS NOT NULL) + (mini_pet_title_operation_id IS NOT NULL) + (package_use_operation_id IS NOT NULL) + (pet_explore_operation_id IS NOT NULL) + (pet_explore_event_control_operation_id IS NOT NULL) + (pet_title_operation_id IS NOT NULL) + (pet_title_batch_operation_id IS NOT NULL) + (player_identity_operation_id IS NOT NULL) = 1),
  ADD CONSTRAINT chk_odbt_472_03_rule_02 CHECK ((receipt_kind = 'DAILY_PRAYER' AND daily_prayer_operation_id IS NOT NULL) OR (receipt_kind = 'HOME_AGGREGATE' AND home_aggregate_operation_id IS NOT NULL) OR (receipt_kind = 'MARKET' AND market_operation_id IS NOT NULL) OR (receipt_kind = 'MEMBER_TITLE' AND member_title_operation_id IS NOT NULL) OR (receipt_kind = 'MINI_PET_TITLE' AND mini_pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PACKAGE_USE' AND package_use_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE' AND pet_explore_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE_EVENT_CONTROL' AND pet_explore_event_control_operation_id IS NOT NULL) OR (receipt_kind = 'PET_TITLE' AND pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PET_TITLE_BATCH' AND pet_title_batch_operation_id IS NOT NULL) OR (receipt_kind = 'PLAYER_IDENTITY' AND player_identity_operation_id IS NOT NULL));
