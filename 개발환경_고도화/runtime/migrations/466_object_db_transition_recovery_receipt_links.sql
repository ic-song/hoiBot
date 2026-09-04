-- WBS743 Gate 2 additive recovery lease and typed receipt-link contract.
-- Requires migrations 461 through 465. Existing rows are backfilled; the pre-cutover writer may insert a nullable compatibility bundle.

-- Migration 462 deliberately did not constrain terminal payload shape. This pure SELECT guard runs before
-- the first DDL and raises ER_SUBQUERY_NO_1_ROW when any replay row cannot satisfy the provider DTO contract.
SELECT (
  SELECT claim_preflight_guard
  FROM (
    SELECT 1 AS claim_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (
      SELECT 1
      FROM canonical_app_wiring_operations
      WHERE (claim_state IN ('CLAIMED','MUTATION_STARTED') AND (result_json IS NOT NULL OR error_code IS NOT NULL))
         OR (claim_state = 'MUTATION_STARTED' AND route IN ('SHADOW','REJECT'))
         OR (claim_state = 'COMPLETED' AND (
              result_json IS NULL
              OR error_code IS NOT NULL
              OR JSON_VALID(result_json) <> 1
              OR JSON_TYPE(JSON_EXTRACT(result_json, '$')) <> 'OBJECT'
              OR JSON_CONTAINS_PATH(result_json, 'one', '$.status') <> 1
              OR JSON_TYPE(JSON_EXTRACT(result_json, '$.status')) <> 'STRING'
              OR JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.status')) NOT REGEXP '^[A-Z][A-Z0-9_]{0,63}$'
              OR JSON_LENGTH(JSON_KEYS(result_json)) <> 1
                 + JSON_CONTAINS_PATH(result_json, 'one', '$.referenceId')
                 + JSON_CONTAINS_PATH(result_json, 'one', '$.resultFingerprint')
              OR (JSON_CONTAINS_PATH(result_json, 'one', '$.referenceId') = 1 AND (
                   JSON_TYPE(JSON_EXTRACT(result_json, '$.referenceId')) <> 'STRING'
                   OR JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.referenceId')) NOT REGEXP '^[A-Za-z0-9._:@/-]{1,191}$'
                 ))
              OR (JSON_CONTAINS_PATH(result_json, 'one', '$.resultFingerprint') = 1 AND (
                   JSON_TYPE(JSON_EXTRACT(result_json, '$.resultFingerprint')) <> 'STRING'
                   OR JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.resultFingerprint')) NOT REGEXP '^[0-9a-f]{64}$'
                 ))
            ))
         OR (claim_state = 'FAILED' AND (result_json IS NOT NULL OR error_code IS NULL))
    )
  ) AS invalid_claim_guard
) AS odbt_466_claim_preflight;

ALTER TABLE canonical_app_wiring_operations
  ADD COLUMN IF NOT EXISTS effect_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER claim_state,
  ADD COLUMN IF NOT EXISTS lease_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER effect_mode,
  ADD COLUMN IF NOT EXISTS lease_generation BIGINT UNSIGNED NULL AFTER lease_token,
  ADD COLUMN IF NOT EXISTS lease_expires_time CHAR(19) NULL AFTER lease_generation,
  ADD COLUMN IF NOT EXISTS attempt_count BIGINT UNSIGNED NULL AFTER lease_expires_time,
  ADD COLUMN IF NOT EXISTS recovery_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER attempt_count,
  ADD COLUMN IF NOT EXISTS recovery_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER recovery_status;

-- Rows that already exist are upgraded without a lease. A pre-cutover writer may still insert an all-NULL
-- transition bundle, so it can create and finish claims without knowing the lease/recovery columns. That
-- bundle is storage compatibility only: the new lease writer must drain/fence it and never auto-adopt or execute it.
UPDATE canonical_app_wiring_operations
SET effect_mode=COALESCE(effect_mode, CASE WHEN route IN ('SHADOW','REJECT') THEN 'READ_ONLY' ELSE 'MUTATION' END),
    lease_generation=COALESCE(lease_generation, 0),
    attempt_count=COALESCE(attempt_count, 1),
    recovery_status=COALESCE(recovery_status, 'NONE'),
    recovery_code=CASE WHEN COALESCE(recovery_status, 'NONE') = 'NONE' THEN NULL ELSE recovery_code END,
    UPDATE_USER='migration:466',
    UPDATE_TIME=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), '%Y-%m-%d %H:%i:%s')
WHERE effect_mode IS NULL OR lease_generation IS NULL OR attempt_count IS NULL OR recovery_status IS NULL;

-- The nullable all-NULL bundle is a deliberate compatibility state. A post-provider-cutover migration must
-- upgrade remaining legacy rows and make the four required metadata columns NOT NULL.
ALTER TABLE canonical_app_wiring_operations
  ADD KEY IF NOT EXISTS ix_odbt_466_01_01 (claim_state, lease_expires_time),
  ADD KEY IF NOT EXISTS ix_odbt_466_01_02 (recovery_status, UPDATE_TIME),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_01 CHECK (effect_mode IS NULL OR effect_mode IN ('READ_ONLY','MUTATION')),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_02 CHECK (effect_mode IS NULL OR route NOT IN ('SHADOW','REJECT') OR effect_mode = 'READ_ONLY'),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_03 CHECK (effect_mode IS NULL OR claim_state <> 'MUTATION_STARTED' OR effect_mode = 'MUTATION'),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_04 CHECK ((claim_state IN ('CLAIMED','MUTATION_STARTED') AND result_json IS NULL AND error_code IS NULL) OR claim_state IN ('COMPLETED','FAILED')),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_05 CHECK ((claim_state = 'COMPLETED' AND result_json IS NOT NULL AND error_code IS NULL) OR claim_state <> 'COMPLETED'),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_06 CHECK ((claim_state = 'FAILED' AND result_json IS NULL AND error_code IS NOT NULL) OR claim_state <> 'FAILED'),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_07 CHECK (claim_state NOT IN ('COMPLETED','FAILED') OR (lease_token IS NULL AND lease_expires_time IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_08 CHECK ((lease_token IS NULL AND lease_expires_time IS NULL) OR (lease_token IS NOT NULL AND lease_expires_time IS NOT NULL)),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_09 CHECK (lease_token IS NULL OR lease_token REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_10 CHECK (lease_expires_time IS NULL OR lease_expires_time REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_11 CHECK ((lease_generation IS NULL AND attempt_count IS NULL) OR (lease_generation >= 0 AND attempt_count >= 1)),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_12 CHECK (recovery_status IS NULL OR recovery_status IN ('NONE','PENDING','RECOVERED','FAILED')),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_13 CHECK (recovery_status IS NULL OR (recovery_status = 'NONE' AND recovery_code IS NULL) OR (recovery_status IN ('PENDING','RECOVERED','FAILED') AND recovery_code IS NOT NULL)),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_14 CHECK ((effect_mode IS NULL AND lease_token IS NULL AND lease_generation IS NULL AND lease_expires_time IS NULL AND attempt_count IS NULL AND recovery_status IS NULL AND recovery_code IS NULL) OR (effect_mode IS NOT NULL AND lease_generation IS NOT NULL AND attempt_count IS NOT NULL AND recovery_status IS NOT NULL)),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_15 CHECK (recovery_status IS NULL OR (recovery_status = 'NONE' AND (claim_state IN ('CLAIMED','COMPLETED','FAILED') OR (claim_state = 'MUTATION_STARTED' AND lease_token IS NULL AND lease_generation = 0))) OR (recovery_status IN ('PENDING','FAILED') AND claim_state = 'MUTATION_STARTED') OR (recovery_status = 'RECOVERED' AND claim_state IN ('CLAIMED','COMPLETED','FAILED'))),
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_16 CHECK (lease_token IS NULL OR lease_generation >= 1);

CREATE TABLE IF NOT EXISTS canonical_app_wiring_receipt_links (
  canonical_app_wiring_receipt_link_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_wiring_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receipt_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  daily_prayer_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  home_aggregate_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  market_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  member_title_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  mini_pet_title_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  package_use_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  pet_explore_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  pet_title_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  player_identity_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (canonical_app_wiring_receipt_link_id),
  UNIQUE KEY uq_odbt_466_02_01 (app_wiring_operation_id, receipt_kind),
  UNIQUE KEY uq_odbt_466_02_02 (daily_prayer_operation_id),
  UNIQUE KEY uq_odbt_466_02_03 (home_aggregate_operation_id),
  UNIQUE KEY uq_odbt_466_02_04 (market_operation_id),
  UNIQUE KEY uq_odbt_466_02_05 (member_title_operation_id),
  UNIQUE KEY uq_odbt_466_02_06 (mini_pet_title_operation_id),
  UNIQUE KEY uq_odbt_466_02_07 (package_use_operation_id),
  UNIQUE KEY uq_odbt_466_02_08 (pet_explore_operation_id),
  UNIQUE KEY uq_odbt_466_02_09 (pet_title_operation_id),
  UNIQUE KEY uq_odbt_466_02_10 (player_identity_operation_id),
  CONSTRAINT fk_odbt_466_02_01 FOREIGN KEY (app_wiring_operation_id) REFERENCES canonical_app_wiring_operations (app_wiring_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_02 FOREIGN KEY (daily_prayer_operation_id) REFERENCES canonical_daily_prayer_operations (daily_prayer_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_03 FOREIGN KEY (home_aggregate_operation_id) REFERENCES canonical_home_aggregate_operations (home_aggregate_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_04 FOREIGN KEY (market_operation_id) REFERENCES canonical_market_operations (market_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_05 FOREIGN KEY (member_title_operation_id) REFERENCES canonical_member_title_operations (member_title_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_06 FOREIGN KEY (mini_pet_title_operation_id) REFERENCES canonical_mini_pet_title_operations (mini_pet_title_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_07 FOREIGN KEY (package_use_operation_id) REFERENCES canonical_package_use_operations (package_use_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_08 FOREIGN KEY (pet_explore_operation_id) REFERENCES canonical_pet_explore_operations (pet_explore_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_09 FOREIGN KEY (pet_title_operation_id) REFERENCES canonical_pet_title_operations (pet_title_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_466_02_10 FOREIGN KEY (player_identity_operation_id) REFERENCES canonical_player_identity_operations (player_identity_operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_466_02_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_466_02_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  -- Equality with the selected heterogeneous operation table's fingerprint is a runtime insert/replay responsibility.
  CONSTRAINT chk_odbt_466_02_rule_01 CHECK (result_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_466_02_rule_02 CHECK ((daily_prayer_operation_id IS NOT NULL) + (home_aggregate_operation_id IS NOT NULL) + (market_operation_id IS NOT NULL) + (member_title_operation_id IS NOT NULL) + (mini_pet_title_operation_id IS NOT NULL) + (package_use_operation_id IS NOT NULL) + (pet_explore_operation_id IS NOT NULL) + (pet_title_operation_id IS NOT NULL) + (player_identity_operation_id IS NOT NULL) = 1),
  CONSTRAINT chk_odbt_466_02_rule_03 CHECK ((receipt_kind = 'DAILY_PRAYER' AND daily_prayer_operation_id IS NOT NULL) OR (receipt_kind = 'HOME_AGGREGATE' AND home_aggregate_operation_id IS NOT NULL) OR (receipt_kind = 'MARKET' AND market_operation_id IS NOT NULL) OR (receipt_kind = 'MEMBER_TITLE' AND member_title_operation_id IS NOT NULL) OR (receipt_kind = 'MINI_PET_TITLE' AND mini_pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PACKAGE_USE' AND package_use_operation_id IS NOT NULL) OR (receipt_kind = 'PET_EXPLORE' AND pet_explore_operation_id IS NOT NULL) OR (receipt_kind = 'PET_TITLE' AND pet_title_operation_id IS NOT NULL) OR (receipt_kind = 'PLAYER_IDENTITY' AND player_identity_operation_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
