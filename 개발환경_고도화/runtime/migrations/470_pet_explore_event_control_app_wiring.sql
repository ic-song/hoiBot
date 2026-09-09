-- WBS743: global pet-explore event control typed receipt for app-wiring MODERN/MUTATION.
CREATE TABLE IF NOT EXISTS canonical_pet_explore_event_control_operations (
  pet_explore_event_control_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_active BOOLEAN NOT NULL,
  previous_active BOOLEAN NOT NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  resulting_version BIGINT UNSIGNED NOT NULL,
  relocated_participant_count BIGINT UNSIGNED NOT NULL,
  replay_namespace VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_explore_event_control_operation_id),
  UNIQUE KEY uq_odbt_470_01_01 (replay_namespace, request_key),
  CONSTRAINT chk_odbt_470_01_event CHECK (event_code IN ('diamond_mine','guild_raid')),
  CONSTRAINT chk_odbt_470_01_version CHECK (resulting_version = previous_version OR resulting_version = previous_version + 1),
  CONSTRAINT chk_odbt_470_01_payload CHECK (payload_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_470_01_result CHECK (result_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_470_01_status CHECK (operation_status IN ('COMPLETED','FAILED')),
  CONSTRAINT chk_odbt_470_01_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_470_01_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE canonical_app_wiring_receipt_links
  DROP CONSTRAINT IF EXISTS chk_odbt_466_02_rule_03,
  DROP CONSTRAINT IF EXISTS chk_odbt_466_02_rule_02,
  ADD COLUMN IF NOT EXISTS pet_explore_event_control_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER pet_explore_operation_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_odbt_470_02_01 (pet_explore_event_control_operation_id),
  ADD CONSTRAINT fk_odbt_470_02_01 FOREIGN KEY IF NOT EXISTS (pet_explore_event_control_operation_id) REFERENCES canonical_pet_explore_event_control_operations (pet_explore_event_control_operation_id) ON DELETE RESTRICT,
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_470_02_rule_01 CHECK ((daily_prayer_operation_id IS NOT NULL) + (home_aggregate_operation_id IS NOT NULL) + (market_operation_id IS NOT NULL) + (member_title_operation_id IS NOT NULL) + (mini_pet_title_operation_id IS NOT NULL) + (package_use_operation_id IS NOT NULL) + (pet_explore_operation_id IS NOT NULL) + (pet_explore_event_control_operation_id IS NOT NULL) + (pet_title_operation_id IS NOT NULL) + (player_identity_operation_id IS NOT NULL) = 1),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_470_02_rule_02 CHECK ((receipt_kind = 'DAILY_PRAYER' AND daily_prayer_operation_id IS NOT NULL) OR (receipt_kind = 'HOME_AGGREGATE' AND home_aggregate_operation_id IS NOT NULL) OR (receipt_kind = 'MARKET' AND market_operation_id IS NOT NULL) OR (receipt_kind = 'MEMBER_TITLE' AND member_title_operation_id IS NOT NULL) OR (receipt_kind = 'MINI_PET_TITLE' AND mini_pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PACKAGE_USE' AND package_use_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE' AND pet_explore_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE_EVENT_CONTROL' AND pet_explore_event_control_operation_id IS NOT NULL) OR (receipt_kind = 'PET_TITLE' AND pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PLAYER_IDENTITY' AND player_identity_operation_id IS NOT NULL));
