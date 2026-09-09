CREATE TABLE IF NOT EXISTS legacy_snapshot_environments (
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  database_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_snapshot_set_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (environment_code),
  UNIQUE KEY uq_legacy_snapshot_database_identity (database_identity),
  CONSTRAINT ck_legacy_snapshot_environment CHECK (environment_code IN ('prod','dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legacy_snapshot_sets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  database_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  snapshot_at DATETIME(3) NOT NULL,
  snapshot_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ready',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_legacy_snapshot_set_version (environment_code,snapshot_version),
  KEY ix_legacy_snapshot_set_identity (database_identity,snapshot_version),
  CONSTRAINT fk_legacy_snapshot_set_environment FOREIGN KEY (environment_code) REFERENCES legacy_snapshot_environments(environment_code),
  CONSTRAINT ck_legacy_snapshot_set_status CHECK (snapshot_status IN ('building','ready','invalid'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE legacy_snapshot_environments
  ADD CONSTRAINT fk_legacy_snapshot_environment_active_set
  FOREIGN KEY (active_snapshot_set_id) REFERENCES legacy_snapshot_sets(id);

CREATE TABLE IF NOT EXISTS legacy_source_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_set_id BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_json LONGTEXT NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  utf16_code_unit_count BIGINT UNSIGNED NOT NULL,
  entity_count BIGINT UNSIGNED NOT NULL,
  read_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'valid',
  captured_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legacy_source_snapshot (snapshot_set_id,source_code),
  CONSTRAINT fk_legacy_source_snapshot_set FOREIGN KEY (snapshot_set_id) REFERENCES legacy_snapshot_sets(id) ON DELETE CASCADE,
  CONSTRAINT ck_legacy_source_snapshot_json CHECK (JSON_VALID(raw_json)),
  CONSTRAINT ck_legacy_source_snapshot_hash CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_legacy_source_snapshot_status CHECK (read_status IN ('valid','missing','invalid'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_character_count_stat_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  snapshot_set_id BIGINT UNSIGNED NOT NULL,
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  database_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  source_count SMALLINT UNSIGNED NOT NULL,
  projection_count SMALLINT UNSIGNED NOT NULL,
  result_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_admin_character_count_snapshot (snapshot_set_id),
  CONSTRAINT fk_admin_character_count_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_character_count_snapshot_set FOREIGN KEY (snapshot_set_id) REFERENCES legacy_snapshot_sets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO legacy_snapshot_environments(environment_code,database_identity)
VALUES ('prod','hoibot-prod'),('dev','hoibot-dev')
ON DUPLICATE KEY UPDATE database_identity=VALUES(database_identity);

INSERT INTO admin_permissions(code,display_name)
VALUES ('stats.character_count.read','저장 데이터 글자 수 통계 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'stats.character_count.read' FROM admin_roles WHERE code='super_admin' AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_CHARACTER_COUNT_STATS','admin_character_count_stats','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/글자수통계','ADMIN_CHARACTER_COUNT_STATS',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
