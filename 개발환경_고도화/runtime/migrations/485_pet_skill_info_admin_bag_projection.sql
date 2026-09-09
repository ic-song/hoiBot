-- WBS764: room-scoped admin bag authority and complete legacy rank marker projection.

INSERT INTO admin_permissions(code,display_name)
VALUES('pet.skill.info.admin_bag.read','관리자 펫스킬 가방 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet.skill.info.admin_bag.read' FROM admin_roles
WHERE code IN ('manager','super_admin') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

CREATE TABLE pet_skill_info_admin_channel_authorities (
  pet_skill_info_admin_channel_authority_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_channel_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operator_scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authority_decision VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  revision BIGINT UNSIGNED NOT NULL,
  source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(pet_skill_info_admin_channel_authority_id),
  UNIQUE KEY uq_pet_skill_info_admin_channel_authority(provider_code,external_channel_id,operator_scope,authority_decision,active_flag),
  CONSTRAINT fk_pet_skill_info_admin_channel_authority_channel FOREIGN KEY(provider_code,external_channel_id) REFERENCES channels(provider_code,external_channel_id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_skill_info_admin_channel_scope CHECK(operator_scope IN ('ADMIN','MASTER')),
  CONSTRAINT chk_pet_skill_info_admin_channel_provider CHECK(provider_code='kakao'),
  CONSTRAINT chk_pet_skill_info_admin_channel_decision CHECK(authority_decision IN ('ALLOW','DENY')),
  CONSTRAINT chk_pet_skill_info_admin_channel_revision CHECK(revision>=1),
  CONSTRAINT chk_pet_skill_info_admin_channel_fingerprint CHECK(source_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_pet_skill_info_admin_channel_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_pet_skill_info_admin_channel_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_pet_skill_rank_marker_projections (
  player_pet_skill_rank_marker_projection_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  marker_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  marker_priority TINYINT UNSIGNED NOT NULL,
  assignment_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  active_marker_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (CASE WHEN active_flag THEN marker_kind ELSE NULL END) STORED,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(player_pet_skill_rank_marker_projection_id),
  UNIQUE KEY uq_player_pet_skill_active_rank_marker_kind(active_marker_kind),
  KEY idx_player_pet_skill_rank_marker_player(player_id,active_flag,marker_priority),
  CONSTRAINT fk_player_pet_skill_rank_marker_player FOREIGN KEY(player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_player_pet_skill_rank_marker_kind CHECK(marker_kind IN ('CASTLE_LORD','STAR','CARROT','THERMO','MINI_PET','TOP_LEVEL','MC','INTIMACY')),
  CONSTRAINT chk_player_pet_skill_rank_marker_assignment CHECK((assignment_status='ASSIGNED' AND player_id IS NOT NULL) OR (assignment_status='UNASSIGNED' AND player_id IS NULL)),
  CONSTRAINT chk_player_pet_skill_rank_marker_priority CHECK(marker_priority BETWEEN 1 AND 8),
  CONSTRAINT chk_player_pet_skill_rank_marker_pair CHECK(marker_priority=CASE marker_kind WHEN 'CASTLE_LORD' THEN 1 WHEN 'STAR' THEN 2 WHEN 'CARROT' THEN 3 WHEN 'THERMO' THEN 4 WHEN 'MINI_PET' THEN 5 WHEN 'TOP_LEVEL' THEN 6 WHEN 'MC' THEN 7 WHEN 'INTIMACY' THEN 8 END),
  CONSTRAINT chk_player_pet_skill_rank_marker_revision CHECK(revision>=1),
  CONSTRAINT chk_player_pet_skill_rank_marker_fingerprint CHECK(source_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_pet_skill_rank_marker_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_player_pet_skill_rank_marker_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_pet_skill_bag_import_completeness_projections (
  player_pet_skill_bag_import_completeness_projection_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_domain_import_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_source_key_count INT UNSIGNED NOT NULL,
  projected_stack_count INT UNSIGNED NOT NULL,
  quarantined_source_key_count INT UNSIGNED NOT NULL,
  ignored_source_key_count INT UNSIGNED NOT NULL,
  source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_projection_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_set_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stack_set_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  active_player_guard TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN active_flag THEN 1 ELSE NULL END) STORED,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(player_pet_skill_bag_import_completeness_projection_id),
  UNIQUE KEY uq_player_pet_skill_bag_import_completeness_active(player_id,active_player_guard),
  KEY idx_player_pet_skill_bag_import_completeness_player(player_id,revision),
  CONSTRAINT fk_player_pet_skill_bag_import_completeness_player FOREIGN KEY(player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_pet_skill_bag_import_completeness_run FOREIGN KEY(object_domain_import_run_id) REFERENCES data_migration_object_domain_import_runs(object_domain_import_run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_counts CHECK(projected_stack_count=expected_source_key_count AND quarantined_source_key_count=0 AND ignored_source_key_count=0),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_revision CHECK(revision>=1),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_fingerprint CHECK(source_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_catalog_fingerprint CHECK(catalog_projection_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_catalog_set CHECK(catalog_set_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_stack_set CHECK(stack_set_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_player_pet_skill_bag_import_completeness_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
