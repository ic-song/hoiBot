CREATE TABLE IF NOT EXISTS bot_recovery_set_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  generation_id BIGINT UNSIGNED NOT NULL,
  environment_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_revision_key VARCHAR(191) NOT NULL,
  restore_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  restored_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  restored_at DATETIME(3) NULL,
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_bot_recovery_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_bot_recovery_run_generation FOREIGN KEY (generation_id) REFERENCES backup_generations(id),
  CONSTRAINT ck_bot_recovery_run_environment CHECK (environment_code='prod'),
  CONSTRAINT ck_bot_recovery_run_slot CHECK (slot_code='backup1'),
  CONSTRAINT ck_bot_recovery_run_status CHECK (restore_status IN ('processing','complete','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_recovery_set_items (
  operation_id BIGINT UNSIGNED NOT NULL,
  target_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_backup_object_id BIGINT UNSIGNED NOT NULL,
  required_item BOOLEAN NOT NULL,
  before_target_object_id BIGINT UNSIGNED NULL,
  before_object_existed BOOLEAN NOT NULL,
  before_payload_text MEDIUMTEXT NULL,
  before_content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  before_size_bytes BIGINT UNSIGNED NULL,
  before_revision BIGINT UNSIGNED NULL,
  after_target_object_id BIGINT UNSIGNED NULL,
  after_revision BIGINT UNSIGNED NULL,
  PRIMARY KEY (operation_id,target_code),
  CONSTRAINT fk_bot_recovery_item_run FOREIGN KEY (operation_id) REFERENCES bot_recovery_set_runs(operation_id) ON DELETE CASCADE,
  CONSTRAINT fk_bot_recovery_item_source FOREIGN KEY (source_backup_object_id) REFERENCES backup_objects(id),
  CONSTRAINT fk_bot_recovery_item_before FOREIGN KEY (before_target_object_id) REFERENCES managed_data_objects(id),
  CONSTRAINT fk_bot_recovery_item_after FOREIGN KEY (after_target_object_id) REFERENCES managed_data_objects(id),
  CONSTRAINT ck_bot_recovery_item_target CHECK (target_code IN ('member','member_pet','petSkillData','petHomeActivityData')),
  CONSTRAINT ck_bot_recovery_item_snapshot CHECK (
    (before_object_existed=TRUE AND before_payload_text IS NOT NULL AND before_content_sha256 IS NOT NULL AND before_size_bytes IS NOT NULL AND before_revision IS NOT NULL)
    OR
    (before_object_existed=FALSE AND before_payload_text IS NULL AND before_content_sha256 IS NULL AND before_size_bytes IS NULL AND before_revision IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('BOT_RECOVERY_SET','bot_recovery_set','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/봇살리기','BOT_RECOVERY_SET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
