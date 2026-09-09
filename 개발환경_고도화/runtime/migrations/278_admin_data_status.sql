CREATE TABLE IF NOT EXISTS backup_generations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id), UNIQUE KEY uq_backup_generation_revision (environment_code,revision_key),
  KEY ix_backup_generation_latest (environment_code,generation_status,completed_at,id),
  CONSTRAINT ck_backup_generation_environment CHECK (environment_code IN ('prod','dev')),
  CONSTRAINT ck_backup_generation_status CHECK (generation_status IN ('building','complete','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_objects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  generation_id BIGINT UNSIGNED NOT NULL,
  target_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_exists BOOLEAN NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  size_bytes BIGINT UNSIGNED NULL,
  modified_at DATETIME(3) NULL,
  storage_locator VARCHAR(255) NULL,
  PRIMARY KEY (id), UNIQUE KEY uq_backup_object_slot (generation_id,target_code,slot_code),
  CONSTRAINT fk_backup_object_generation FOREIGN KEY (generation_id) REFERENCES backup_generations(id) ON DELETE CASCADE,
  CONSTRAINT ck_backup_object_target CHECK (target_code IN ('member','member_pet','petSkillData','petHomeActivityData')),
  CONSTRAINT ck_backup_object_slot CHECK (slot_code IN ('original','backup1','backup2'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_health_checks (
  backup_object_id BIGINT UNSIGNED NOT NULL,
  valid_json BOOLEAN NOT NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  checked_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (backup_object_id),
  CONSTRAINT fk_backup_health_object FOREIGN KEY (backup_object_id) REFERENCES backup_objects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES ('backup_status.read','백업 데이터 상태 조회') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'backup_status.read' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES ('ADMIN_DATA_STATUS','admin_data_status','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/데이터상태','ADMIN_DATA_STATUS',TRUE),('dev/데이터상태','ADMIN_DATA_STATUS',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
