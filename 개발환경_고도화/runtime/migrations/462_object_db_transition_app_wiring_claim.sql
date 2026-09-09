-- WBS743 Gate 2 additive object DB transition provider.
-- Requires existing migrations through 460_data_migration_object_domain_import.sql.
-- CREATE TABLE IF NOT EXISTS permits safe re-entry after an unrecorded partial multi-statement run.

CREATE TABLE IF NOT EXISTS canonical_app_wiring_operations (
  app_wiring_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_identity_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_namespace VARCHAR(76) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entrypoint_kind VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_request_id VARCHAR(172) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(182) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_code VARCHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  database_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  route VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  handler_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claim_state VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json LONGTEXT NULL,
  error_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (app_wiring_operation_id),
  UNIQUE KEY uq_odbt_462_01_01 (request_identity_fingerprint),
  UNIQUE KEY uq_odbt_462_01_02 (request_namespace, request_key),
  CONSTRAINT chk_odbt_462_01_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_462_01_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_462_01_rule_01 CHECK (environment_code IN ('dev','prod')),
  CONSTRAINT chk_odbt_462_01_rule_02 CHECK (entrypoint_kind IN ('IRIS','AUTOMATIC','ADMIN','WEB')),
  CONSTRAINT chk_odbt_462_01_rule_03 CHECK (claim_state IN ('CLAIMED','MUTATION_STARTED','COMPLETED','FAILED')),
  CONSTRAINT chk_odbt_462_01_rule_04 CHECK (route IN ('MODERN','SHADOW','LEGACY_FALLBACK','REJECT')),
  CONSTRAINT chk_odbt_462_01_rule_05 CHECK (request_namespace REGEXP '^hoibot:(dev|prod):[A-Za-z0-9_$-]{1,64}$'),
  CONSTRAINT chk_odbt_462_01_rule_06 CHECK (request_namespace = CONCAT('hoibot:', environment_code, ':', database_identity)),
  CONSTRAINT chk_odbt_462_01_rule_07 CHECK (external_request_id REGEXP '^[A-Za-z0-9._:@/-]{1,172}$'),
  CONSTRAINT chk_odbt_462_01_rule_08 CHECK (request_key REGEXP '^(IRIS|AUTOMATIC|ADMIN|WEB):[A-Za-z0-9._:@/-]{1,172}$'),
  CONSTRAINT chk_odbt_462_01_rule_09 CHECK (request_identity_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_462_01_rule_10 CHECK (payload_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_462_01_rule_11 CHECK (route = 'REJECT' OR command_code IS NOT NULL OR handler_key IS NOT NULL),
  CONSTRAINT chk_odbt_462_01_rule_12 CHECK (CHAR_LENGTH(request_namespace) > 0 AND CHAR_LENGTH(database_identity) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

