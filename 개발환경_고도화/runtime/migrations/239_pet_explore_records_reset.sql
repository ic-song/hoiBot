START TRANSACTION;

CREATE TABLE pet_explore_record_reset_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 deleted_count BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 CONSTRAINT fk_pet_explore_record_reset_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_record_reset_backups(
 operation_id BIGINT UNSIGNED NOT NULL,
 player_name VARCHAR(191) NOT NULL,
 win_count BIGINT UNSIGNED NOT NULL,
 lose_count BIGINT UNSIGNED NOT NULL,
 source_order INT UNSIGNED NOT NULL,
 imported_at DATETIME(3) NOT NULL,
 PRIMARY KEY(operation_id,player_name),
 CONSTRAINT fk_pet_explore_record_reset_backup_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES
('pet.explore.records.reset_all','펫탐험 전체 전적 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet.explore.records.reset_all' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('PET_EXPLORE_RECORDS_RESET','pet_explore_records_reset','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/펫탐험전체전적초기화','PET_EXPLORE_RECORDS_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
