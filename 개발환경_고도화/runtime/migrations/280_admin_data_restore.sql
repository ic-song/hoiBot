CREATE TABLE IF NOT EXISTS backup_object_payloads (
  backup_object_id BIGINT UNSIGNED NOT NULL,
  payload_text MEDIUMTEXT NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (backup_object_id),
  CONSTRAINT fk_backup_payload_object FOREIGN KEY (backup_object_id) REFERENCES backup_objects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS restore_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  generation_id BIGINT UNSIGNED NOT NULL,
  source_backup_object_id BIGINT UNSIGNED NOT NULL,
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  before_target_object_id BIGINT UNSIGNED NULL,
  after_target_object_id BIGINT UNSIGNED NULL,
  before_revision BIGINT UNSIGNED NULL,
  after_revision BIGINT UNSIGNED NULL,
  restore_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  restored_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_restore_operation (operation_id),
  CONSTRAINT fk_restore_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_restore_generation FOREIGN KEY (generation_id) REFERENCES backup_generations(id),
  CONSTRAINT fk_restore_source_object FOREIGN KEY (source_backup_object_id) REFERENCES backup_objects(id),
  CONSTRAINT fk_restore_before_target FOREIGN KEY (before_target_object_id) REFERENCES managed_data_objects(id),
  CONSTRAINT fk_restore_after_target FOREIGN KEY (after_target_object_id) REFERENCES managed_data_objects(id),
  CONSTRAINT ck_restore_environment CHECK (environment_code IN ('prod','dev')),
  CONSTRAINT ck_restore_target CHECK (target_code IN ('member','member_pet','petSkillData','petHomeActivityData')),
  CONSTRAINT ck_restore_slot CHECK (slot_code IN ('backup1','backup2')),
  CONSTRAINT ck_restore_status CHECK (restore_status IN ('processing','complete','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS restore_snapshots (
  restore_operation_id BIGINT UNSIGNED NOT NULL,
  object_existed BOOLEAN NOT NULL,
  payload_text MEDIUMTEXT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  size_bytes BIGINT UNSIGNED NULL,
  revision_version BIGINT UNSIGNED NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (restore_operation_id),
  CONSTRAINT fk_restore_snapshot_operation FOREIGN KEY (restore_operation_id) REFERENCES restore_operations(id) ON DELETE CASCADE,
  CONSTRAINT ck_restore_snapshot_payload CHECK (
    (object_existed=TRUE AND payload_text IS NOT NULL AND content_sha256 IS NOT NULL AND size_bytes IS NOT NULL AND revision_version IS NOT NULL)
    OR
    (object_existed=FALSE AND payload_text IS NULL AND content_sha256 IS NULL AND size_bytes IS NULL AND revision_version IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES ('data_restore.execute','백업 데이터 복구 실행') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'data_restore.execute' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES ('ADMIN_DATA_RESTORE','admin_data_restore','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/데이터복구','ADMIN_DATA_RESTORE',TRUE),('dev/데이터복구','ADMIN_DATA_RESTORE',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
