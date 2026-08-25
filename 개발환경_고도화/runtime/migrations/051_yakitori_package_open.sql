CREATE TABLE mini_pet_projection_environment_identity (
  singleton_id TINYINT UNSIGNED NOT NULL,
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  database_identity CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configured_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (singleton_id),
  UNIQUE KEY uq_mini_pet_projection_database_identity (database_identity),
  CONSTRAINT ck_mini_pet_projection_environment_singleton CHECK (singleton_id = 1),
  CONSTRAINT ck_mini_pet_projection_environment_code CHECK (environment_code IN ('prod', 'dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_owned_snapshot_versions (
  environment_code VARCHAR(16) NOT NULL,
  snapshot_version VARCHAR(64) NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  PRIMARY KEY (environment_code, snapshot_version),
  CONSTRAINT ck_mini_pet_owned_snapshot_environment CHECK (environment_code IN ('prod', 'dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_owned_read_snapshots (
  environment_code VARCHAR(16) NOT NULL,
  snapshot_version VARCHAR(64) NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  custom_name VARCHAR(191) NULL,
  battle_experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (environment_code, snapshot_version, owned_mini_pet_id),
  KEY ix_mini_pet_owned_snapshot_rank (environment_code, snapshot_version, equipped, battle_experience, owned_mini_pet_id),
  KEY ix_mini_pet_owned_snapshot_player (environment_code, snapshot_version, player_id),
  CONSTRAINT fk_mini_pet_owned_snapshot_version FOREIGN KEY (environment_code, snapshot_version)
    REFERENCES mini_pet_owned_snapshot_versions(environment_code, snapshot_version),
  CONSTRAINT fk_mini_pet_owned_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_mini_pet_owned_snapshot_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_catalog_snapshots (
  pool_version VARCHAR(64) NOT NULL,
  environment_code VARCHAR(16) NOT NULL,
  catalog_kind VARCHAR(32) NOT NULL,
  definition_version VARCHAR(64) NOT NULL,
  owned_snapshot_version VARCHAR(64) NOT NULL,
  snapshot_at DATETIME(3) NOT NULL,
  grade_table_json JSON NOT NULL,
  allowed_grades_json JSON NOT NULL,
  stage_rewards_json JSON NOT NULL,
  total_raw_probability DECIMAL(20,8) NOT NULL DEFAULT 0,
  total_normalized_rate DECIMAL(9,4) NOT NULL DEFAULT 0,
  zero_total BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'published',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (environment_code, pool_version),
  CONSTRAINT fk_mini_pet_catalog_owned_snapshot FOREIGN KEY (environment_code, owned_snapshot_version)
    REFERENCES mini_pet_owned_snapshot_versions(environment_code, snapshot_version),
  CONSTRAINT ck_mini_pet_catalog_environment CHECK (environment_code IN ('prod', 'dev')),
  CONSTRAINT ck_mini_pet_catalog_kind CHECK (catalog_kind IN ('draw_rate', 'fixed_reward')),
  CONSTRAINT ck_mini_pet_catalog_status CHECK (status IN ('draft', 'published', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_catalog_entries (
  environment_code VARCHAR(16) NOT NULL,
  pool_version VARCHAR(64) NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  definition_code VARCHAR(96) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  grade_code VARCHAR(96) NOT NULL,
  grade_display_name VARCHAR(96) NOT NULL,
  emoji_value VARCHAR(32) NOT NULL,
  filter_key VARCHAR(191) NOT NULL,
  raw_probability DECIMAL(20,8) NULL,
  normalized_rate DECIMAL(9,4) NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (environment_code, pool_version, source_order),
  UNIQUE KEY uq_mini_pet_catalog_definition (environment_code, pool_version, definition_code),
  CONSTRAINT fk_mini_pet_catalog_snapshot FOREIGN KEY (environment_code, pool_version)
    REFERENCES mini_pet_catalog_snapshots(environment_code, pool_version),
  CONSTRAINT fk_mini_pet_catalog_definition FOREIGN KEY (mini_pet_definition_id)
    REFERENCES mini_pet_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_collection_projections (
  player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  registered BOOLEAN NOT NULL DEFAULT FALSE,
  stage INT UNSIGNED NOT NULL DEFAULT 1,
  completed_stage INT UNSIGNED NOT NULL DEFAULT 0,
  projection_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id, mini_pet_definition_id),
  CONSTRAINT fk_mini_pet_collection_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_mini_pet_collection_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_read_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) NOT NULL,
  environment_code VARCHAR(16) NOT NULL,
  pool_version VARCHAR(64) NOT NULL,
  projection_code VARCHAR(48) NOT NULL,
  snapshot_at DATETIME(3) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'processing',
  started_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_mini_pet_read_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT ck_mini_pet_read_environment CHECK (environment_code IN ('prod', 'dev')),
  CONSTRAINT ck_mini_pet_read_status CHECK (status IN ('processing', 'completed', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_trusted_admin_identities (
  external_identity_id BIGINT UNSIGNED NOT NULL,
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_by_operator_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  approved_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (external_identity_id, environment_code),
  CONSTRAINT fk_mini_pet_trusted_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities(id),
  CONSTRAINT fk_mini_pet_trusted_approver FOREIGN KEY (approved_by_operator_id) REFERENCES admin_operators(id),
  CONSTRAINT ck_mini_pet_trusted_environment CHECK (environment_code IN ('prod', 'dev')),
  CONSTRAINT ck_mini_pet_trusted_status CHECK (status IN ('active', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_owner_read_snapshots (
  environment_code VARCHAR(16) NOT NULL,
  snapshot_version VARCHAR(64) NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  owner_display_name VARCHAR(191) NOT NULL,
  owner_check_rank VARCHAR(191) NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  PRIMARY KEY (environment_code, snapshot_version, player_id),
  CONSTRAINT fk_mini_pet_owner_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT ck_mini_pet_owner_snapshot_environment CHECK (environment_code IN ('prod', 'dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_admin_snapshot_field_allowlist (
  field_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (field_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_admin_legacy_snapshot_fields (
  environment_code VARCHAR(16) NOT NULL,
  snapshot_version VARCHAR(64) NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  field_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  field_value_json JSON NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  PRIMARY KEY (environment_code, snapshot_version, player_id, field_code),
  CONSTRAINT fk_mini_pet_admin_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_mini_pet_admin_snapshot_field FOREIGN KEY (field_code) REFERENCES mini_pet_admin_snapshot_field_allowlist(field_code),
  CONSTRAINT ck_mini_pet_admin_snapshot_environment CHECK (environment_code IN ('prod', 'dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_admin_snapshot_field_allowlist (field_code, is_sensitive) VALUES
  ('profile', TRUE), ('equipped', TRUE), ('bag', TRUE), ('battle', TRUE),
  ('collection', TRUE), ('draw', TRUE)
ON DUPLICATE KEY UPDATE is_sensitive = VALUES(is_sensitive);

INSERT INTO admin_permissions (code, display_name) VALUES
  ('minipet.admin_info.read', '미니펫 관리자 정보 조회'),
  ('minipet.catalog.publish', '미니펫 조회 스냅샷 발행')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles role
JOIN admin_permissions permission ON permission.code IN ('minipet.admin_info.read', 'minipet.catalog.publish')
WHERE role.code = 'super_admin' AND role.active = TRUE
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);

INSERT INTO mini_pet_definitions
  (code, display_name, grade_code, grade_display_name, emoji_value, active)
VALUES
  ('mini_pet_yakitori_01', '태초꼬치', 'grade_primordial', '태초', '🍢', TRUE),
  ('mini_pet_yakitori_02', '태초야키', 'grade_primordial', '태초', '🔥', TRUE),
  ('mini_pet_yakitori_03', '태초숯불꼬치', 'grade_primordial', '태초', '♨️', TRUE),
  ('mini_pet_yakitori_04', '태초한판꼬치', 'grade_primordial', '태초', '🥢', TRUE),
  ('mini_pet_yakitori_05', '태초꼬치집', 'grade_primordial', '태초', '🏮', TRUE),
  ('mini_pet_yakitori_06', '태초닭꼬치', 'grade_primordial', '태초', '🐔', TRUE),
  ('mini_pet_yakitori_07', '태초불향꼬치', 'grade_primordial', '태초', '🔥', TRUE),
  ('mini_pet_yakitori_08', '태초한잔꼬치', 'grade_primordial', '태초', '🍶', TRUE),
  ('mini_pet_yakitori_09', '태초꼬치포차', 'grade_primordial', '태초', '🍻', TRUE),
  ('mini_pet_yakitori_10', '태초직화꼬치', 'grade_primordial', '태초', '🔥', TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = VALUES(active);

INSERT INTO mini_pet_owned_snapshot_versions
  (environment_code, snapshot_version, captured_at)
VALUES
  ('prod', 'yakitori-eccd437-v1', '2026-08-24 00:00:00.000'),
  ('dev', 'yakitori-eccd437-v1', '2026-08-24 00:00:00.000')
ON DUPLICATE KEY UPDATE captured_at = VALUES(captured_at);

INSERT INTO mini_pet_catalog_snapshots
  (pool_version, environment_code, catalog_kind, definition_version, owned_snapshot_version,
   snapshot_at, grade_table_json, allowed_grades_json, stage_rewards_json,
   total_raw_probability, total_normalized_rate, zero_total, status)
VALUES
  ('yakitori-eccd437-v1', 'prod', 'fixed_reward', 'yakitori-eccd437-v1', 'yakitori-eccd437-v1',
   '2026-08-24 00:00:00.000', JSON_OBJECT('창조', 1, '창세', 2, '태초+', 3, '태초', 4, '초월+', 5, '초월', 6, '신화+', 7, '신화', 8), JSON_ARRAY('창조', '창세', '태초+', '태초', '초월+', '초월', '신화+', '신화'), JSON_OBJECT(), 0, 0, TRUE, 'published'),
  ('yakitori-eccd437-v1', 'dev', 'fixed_reward', 'yakitori-eccd437-v1', 'yakitori-eccd437-v1',
   '2026-08-24 00:00:00.000', JSON_OBJECT('창조', 1, '창세', 2, '태초+', 3, '태초', 4, '초월+', 5, '초월', 6, '신화+', 7, '신화', 8), JSON_ARRAY('창조', '창세', '태초+', '태초', '초월+', '초월', '신화+', '신화'), JSON_OBJECT(), 0, 0, TRUE, 'published')
ON DUPLICATE KEY UPDATE catalog_kind = VALUES(catalog_kind), definition_version = VALUES(definition_version),
  owned_snapshot_version = VALUES(owned_snapshot_version), grade_table_json = VALUES(grade_table_json),
  allowed_grades_json = VALUES(allowed_grades_json), stage_rewards_json = VALUES(stage_rewards_json), status = VALUES(status);

INSERT INTO mini_pet_catalog_entries
  (environment_code, pool_version, source_order, mini_pet_definition_id, definition_code,
   display_name, grade_code, grade_display_name, emoji_value, filter_key, raw_probability, normalized_rate, allowed)
SELECT environment.environment_code, 'yakitori-eccd437-v1', seed.source_order, definition.id,
  seed.definition_code, seed.display_name, 'grade_primordial', '태초', seed.emoji_value,
  seed.display_name, NULL, NULL, TRUE
FROM (
  SELECT 'prod' AS environment_code UNION ALL SELECT 'dev'
) environment
JOIN (
  SELECT 1 AS source_order, 'mini_pet_yakitori_01' AS definition_code, '태초꼬치' AS display_name, '🍢' AS emoji_value
  UNION ALL SELECT 2, 'mini_pet_yakitori_02', '태초야키', '🔥'
  UNION ALL SELECT 3, 'mini_pet_yakitori_03', '태초숯불꼬치', '♨️'
  UNION ALL SELECT 4, 'mini_pet_yakitori_04', '태초한판꼬치', '🥢'
  UNION ALL SELECT 5, 'mini_pet_yakitori_05', '태초꼬치집', '🏮'
  UNION ALL SELECT 6, 'mini_pet_yakitori_06', '태초닭꼬치', '🐔'
  UNION ALL SELECT 7, 'mini_pet_yakitori_07', '태초불향꼬치', '🔥'
  UNION ALL SELECT 8, 'mini_pet_yakitori_08', '태초한잔꼬치', '🍶'
  UNION ALL SELECT 9, 'mini_pet_yakitori_09', '태초꼬치포차', '🍻'
  UNION ALL SELECT 10, 'mini_pet_yakitori_10', '태초직화꼬치', '🔥'
) seed
JOIN mini_pet_definitions definition ON definition.code = seed.definition_code
WHERE TRUE
ON DUPLICATE KEY UPDATE
  mini_pet_definition_id = VALUES(mini_pet_definition_id), definition_code = VALUES(definition_code),
  display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value),
  filter_key = VALUES(filter_key), allowed = VALUES(allowed);

INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('bag_yakitori_package_10', '태초야키토리 10세트🥩(/이랏싸이마쎄)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '태초야키토리 10세트🥩(/이랏싸이마쎄)'), TRUE, 1),
  ('bag_3241894752b82f7a', '미니펫뽑기🐹(/미니펫오픈)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '미니펫뽑기🐹(/미니펫오픈)'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code),
  stackable = VALUES(stackable), metadata_json = VALUES(metadata_json), active = VALUES(active);

CREATE TABLE yakitori_package_use_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
  started_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (operation_id),
  KEY ix_yakitori_package_execution_status (environment_code, status, started_at),
  CONSTRAINT fk_yakitori_package_execution_operation FOREIGN KEY (operation_id)
    REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT ck_yakitori_package_execution_environment CHECK (environment_code IN ('prod', 'dev')),
  CONSTRAINT ck_yakitori_package_execution_status CHECK (status IN ('processing', 'completed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE yakitori_package_owned_rewards (
  operation_id BIGINT UNSIGNED NOT NULL,
  reward_ordinal TINYINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id, reward_ordinal),
  UNIQUE KEY uq_yakitori_package_owned_reward (owned_mini_pet_id),
  UNIQUE KEY uq_yakitori_package_stable_owned (stable_owned_id),
  CONSTRAINT fk_yakitori_package_reward_operation FOREIGN KEY (operation_id)
    REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_yakitori_package_reward_owned FOREIGN KEY (owned_mini_pet_id)
    REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT ck_yakitori_package_reward_ordinal CHECK (reward_ordinal BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
