START TRANSACTION;

CREATE TABLE guild_legacy_fund_cleanup_sources (
  source_key VARCHAR(191) NOT NULL,
  guild_id BIGINT UNSIGNED NULL,
  source_version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  row_state VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'guild',
  legacy_fund_present BOOLEAN NOT NULL DEFAULT FALSE,
  fund_origin_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  legacy_fund_json LONGTEXT NULL,
  non_fund_fields_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  cleaned_at DATETIME(3) NULL,
  PRIMARY KEY(source_key),
  UNIQUE KEY uq_guild_legacy_fund_cleanup_guild(guild_id),
  CONSTRAINT fk_guild_legacy_fund_cleanup_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_legacy_fund_cleanup_json CHECK(legacy_fund_json IS NULL OR JSON_VALID(legacy_fund_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_legacy_fund_cleanup_runs (
  request_key VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  source_version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scanned_count BIGINT UNSIGNED NOT NULL,
  deleted_count BIGINT UNSIGNED NOT NULL,
  skipped_count BIGINT UNSIGNED NOT NULL,
  source_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  normalized_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(request_key),
  UNIQUE KEY uq_guild_legacy_fund_cleanup_operation(operation_id),
  CONSTRAINT fk_guild_legacy_fund_cleanup_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_legacy_fund_cleanup_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_legacy_fund_cleanup_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_legacy_fund_cleanup_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  source_key VARCHAR(191) NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  fund_origin_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  legacy_fund_json LONGTEXT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  CONSTRAINT fk_guild_legacy_fund_change_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_legacy_fund_change_source FOREIGN KEY(source_key) REFERENCES guild_legacy_fund_cleanup_sources(source_key) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_legacy_fund_change_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_legacy_fund_change_json CHECK(legacy_fund_json IS NULL OR JSON_VALID(legacy_fund_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_LEGACY_FUND_CLEANUP','guild_legacy_fund_cleanup','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드fund삭제','GUILD_LEGACY_FUND_CLEANUP',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
