START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES('admin.full_sync.execute','전체 데이터 동기화 실행') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT IGNORE INTO admin_role_permissions(role_id,permission_code) SELECT id,'admin.full_sync.execute' FROM admin_roles WHERE code IN('administrator','manager','super_admin') AND active=1;
CREATE TABLE IF NOT EXISTS admin_full_sync_locks(scope_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,version BIGINT UNSIGNED NOT NULL DEFAULT 1,updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO admin_full_sync_locks(scope_key) VALUES('global');
CREATE TABLE IF NOT EXISTS admin_full_sync_runs(
 operation_id BIGINT UNSIGNED PRIMARY KEY,guild_reconciliation_run_id BIGINT UNSIGNED NULL,source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 synced_count INT UNSIGNED NOT NULL,missing_member_count INT UNSIGNED NOT NULL,duplicated_member_count INT UNSIGNED NOT NULL,pet_removed_count INT UNSIGNED NOT NULL,
 pet_title_member_count INT UNSIGNED NOT NULL,pet_title_removed_count INT UNSIGNED NOT NULL,trial_user_count INT UNSIGNED NOT NULL,trial_progress_removed_count INT UNSIGNED NOT NULL,
 result_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(result_json)),created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 KEY(guild_reconciliation_run_id),CONSTRAINT fk_full_sync_op FOREIGN KEY(operation_id) REFERENCES operations(id),CONSTRAINT fk_full_sync_guild_run FOREIGN KEY(guild_reconciliation_run_id) REFERENCES guild_membership_reconciliation_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS admin_full_sync_phase_results(
 operation_id BIGINT UNSIGNED NOT NULL,sequence_no INT UNSIGNED NOT NULL,phase_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 result_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(result_json)),created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id,phase_code),UNIQUE KEY uq_full_sync_phase_seq(operation_id,sequence_no),CONSTRAINT fk_full_sync_phase_op FOREIGN KEY(operation_id) REFERENCES operations(id),
 CONSTRAINT chk_full_sync_phase CHECK(phase_code IN('member','guild','pet','petTitle','trialTower'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS admin_full_sync_pet_removals(
 operation_id BIGINT UNSIGNED NOT NULL,player_pet_id BIGINT UNSIGNED NOT NULL,player_id BIGINT UNSIGNED NOT NULL,member_key VARCHAR(191) NOT NULL,
 pet_snapshot_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(pet_snapshot_json)),removed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id,player_pet_id),CONSTRAINT fk_full_sync_pet_op FOREIGN KEY(operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS admin_full_sync_pet_title_removals(
 operation_id BIGINT UNSIGNED NOT NULL,player_pet_id BIGINT UNSIGNED NOT NULL,player_id BIGINT UNSIGNED NOT NULL,member_key VARCHAR(191) NOT NULL,title_count INT UNSIGNED NOT NULL,
 title_assignments_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(title_assignments_json)),removed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id,player_pet_id),CONSTRAINT fk_full_sync_pet_title_op FOREIGN KEY(operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('ADMIN_FULL_SYNC','admin_full_sync','VERIFIED_USER','SHADOW',1,1)
 ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=GREATEST(version,VALUES(version));
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/전체동기화','ADMIN_FULL_SYNC',1) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
COMMIT;
