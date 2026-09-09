CREATE TABLE IF NOT EXISTS managed_backup_targets (
  target_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_name VARCHAR(191) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (target_code),
  UNIQUE KEY uq_managed_backup_target_file (file_name),
  UNIQUE KEY uq_managed_backup_target_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS managed_backup_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  source_environment VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_revision_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_count SMALLINT UNSIGNED NOT NULL,
  present_count SMALLINT UNSIGNED NOT NULL,
  missing_count SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_managed_backup_run_operation (operation_id),
  UNIQUE KEY uq_managed_backup_run_revision (source_environment,source_revision_key),
  CONSTRAINT fk_managed_backup_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT ck_managed_backup_run_environment CHECK (source_environment IN ('prod','dev')),
  CONSTRAINT ck_managed_backup_run_status CHECK (run_status IN ('building','complete','failed')),
  CONSTRAINT ck_managed_backup_run_counts CHECK (target_count=present_count+missing_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS managed_backup_manifest (
  run_id BIGINT UNSIGNED NOT NULL,
  target_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_name VARCHAR(191) NOT NULL,
  source_object_id BIGINT UNSIGNED NULL,
  object_exists BOOLEAN NOT NULL,
  source_revision BIGINT UNSIGNED NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  size_bytes BIGINT UNSIGNED NULL,
  modified_at DATETIME(3) NULL,
  payload_text MEDIUMTEXT NULL,
  verification_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (run_id,target_code),
  UNIQUE KEY uq_managed_backup_manifest_file (run_id,file_name),
  CONSTRAINT fk_managed_backup_manifest_run FOREIGN KEY (run_id) REFERENCES managed_backup_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_managed_backup_manifest_target FOREIGN KEY (target_code) REFERENCES managed_backup_targets(target_code),
  CONSTRAINT fk_managed_backup_manifest_source FOREIGN KEY (source_object_id) REFERENCES managed_data_objects(id),
  CONSTRAINT ck_managed_backup_manifest_status CHECK (verification_status IN ('verified','missing')),
  CONSTRAINT ck_managed_backup_manifest_payload CHECK (
    (object_exists=TRUE AND source_object_id IS NOT NULL AND source_revision IS NOT NULL AND content_sha256 IS NOT NULL AND size_bytes IS NOT NULL AND modified_at IS NOT NULL AND payload_text IS NOT NULL AND verification_status='verified')
    OR
    (object_exists=FALSE AND source_object_id IS NULL AND source_revision IS NULL AND content_sha256 IS NULL AND size_bytes IS NULL AND modified_at IS NULL AND payload_text IS NULL AND verification_status='missing')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO managed_backup_targets(target_code,file_name,sort_order,active) VALUES
  ('member','member.json',10,TRUE),
  ('member_pet','member_pet.json',20,TRUE),
  ('board','board.json',30,TRUE),
  ('pet_title','pet_title.json',40,TRUE),
  ('trial_tower','trialTower.json',50,TRUE),
  ('pet_home','petSweetHomeData.json',60,TRUE),
  ('pet_home_placed','petSweetHomeInfo.json',70,TRUE),
  ('pet_home_activity','petHomeActivityData.json',80,TRUE),
  ('member_title','member_title.json',90,TRUE),
  ('guild','guildData.json',100,TRUE)
ON DUPLICATE KEY UPDATE file_name=VALUES(file_name),sort_order=VALUES(sort_order),active=TRUE;
INSERT INTO admin_permissions(code,display_name) VALUES ('managed_backup.execute','운영 데이터 백업 실행') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'managed_backup.execute' FROM admin_roles WHERE code='super_admin' AND active=TRUE ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES ('ADMIN_MANAGED_BACKUP','admin_managed_backup','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/백업','ADMIN_MANAGED_BACKUP',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
