START TRANSACTION;

CREATE TABLE IF NOT EXISTS punch_rank_reset_snapshots(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 operation_id BIGINT UNSIGNED NOT NULL,
 row_count BIGINT UNSIGNED NOT NULL,
 snapshot_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_punch_rank_reset_snapshot_operation(operation_id),
 CONSTRAINT fk_punch_rank_reset_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS punch_rank_reset_snapshot_rows(
 snapshot_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 ordinal_value BIGINT UNSIGNED NOT NULL,
 best_score BIGINT UNSIGNED NOT NULL,
 best_rank VARCHAR(96) NOT NULL,
 total_play BIGINT UNSIGNED NOT NULL,
 total_reward BIGINT UNSIGNED NOT NULL,
 legend_count BIGINT UNSIGNED NOT NULL,
 last_score BIGINT UNSIGNED NOT NULL,
 last_rank VARCHAR(96) NOT NULL,
 source_order BIGINT UNSIGNED NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 source_updated_at DATETIME(3) NOT NULL,
 row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(snapshot_id,player_id),
 UNIQUE KEY uq_punch_rank_reset_snapshot_ordinal(snapshot_id,ordinal_value),
 CONSTRAINT fk_punch_rank_reset_row_snapshot FOREIGN KEY(snapshot_id) REFERENCES punch_rank_reset_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_punch_rank_reset_row_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS punch_rank_reset_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operator_id BIGINT UNSIGNED NOT NULL,
 identity_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 reset_row_count BIGINT UNSIGNED NOT NULL,
 snapshot_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_punch_rank_reset_request(request_key),
 UNIQUE KEY uq_punch_rank_reset_snapshot(snapshot_id),
 CONSTRAINT fk_punch_rank_reset_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_punch_rank_reset_run_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT fk_punch_rank_reset_run_identity FOREIGN KEY(identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_punch_rank_reset_run_snapshot FOREIGN KEY(snapshot_id) REFERENCES punch_rank_reset_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT chk_punch_rank_reset_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_global_locks(lock_code) VALUES('punch_rank_reset')
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO admin_permissions(code,display_name) VALUES('punch.rank.reset','펀치 순위 전체 초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'punch.rank.reset' FROM admin_roles WHERE code='super_admin' AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_PUNCH_RANK_RESET','admin_punch_rank_reset','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펀치순위초기화','ADMIN_PUNCH_RANK_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
