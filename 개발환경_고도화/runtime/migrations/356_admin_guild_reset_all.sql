START TRANSACTION;

CREATE TABLE IF NOT EXISTS admin_guild_reset_state(
 state_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 last_snapshot_id BIGINT UNSIGNED NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(state_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_guild_reset_state(state_key,generation,version)
VALUES('guild_reset_all',0,0)
ON DUPLICATE KEY UPDATE state_key=VALUES(state_key);

CREATE TABLE IF NOT EXISTS admin_guild_reset_operator_allowlist(
 operator_id BIGINT UNSIGNED NOT NULL,
 external_channel_id VARCHAR(191) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operator_id,external_channel_id),
 CONSTRAINT fk_admin_guild_reset_allow_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_guild_reset_snapshots(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 operation_id BIGINT UNSIGNED NOT NULL,
 schema_version INT UNSIGNED NOT NULL,
 generation_before BIGINT UNSIGNED NOT NULL,
 generation_after BIGINT UNSIGNED NULL,
 active_guild_count BIGINT UNSIGNED NOT NULL,
 member_count BIGINT UNSIGNED NOT NULL,
 name_count BIGINT UNSIGNED NOT NULL,
 snapshot_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'building',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 sealed_at DATETIME(3) NULL,
 restored_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_admin_guild_reset_snapshot_operation(operation_id),
 CONSTRAINT fk_admin_guild_reset_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT chk_admin_guild_reset_snapshot_status CHECK(status IN('building','sealed','restored'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_guild_reset_snapshot_rows(
 snapshot_id BIGINT UNSIGNED NOT NULL,
 table_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ordinal_value BIGINT UNSIGNED NOT NULL,
 stable_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 row_json LONGTEXT NOT NULL,
 row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(snapshot_id,table_code,ordinal_value),
 UNIQUE KEY uq_admin_guild_reset_snapshot_stable(snapshot_id,table_code,stable_key),
 CONSTRAINT fk_admin_guild_reset_snapshot_row_snapshot FOREIGN KEY(snapshot_id) REFERENCES admin_guild_reset_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT chk_admin_guild_reset_snapshot_table CHECK(table_code IN('guilds','guild_members','guild_name_registry')),
 CONSTRAINT chk_admin_guild_reset_snapshot_row_json CHECK(JSON_VALID(row_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_guild_reset_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operator_id BIGINT UNSIGNED NOT NULL,
 identity_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 generation_before BIGINT UNSIGNED NOT NULL,
 generation_after BIGINT UNSIGNED NOT NULL,
 reset_guild_count BIGINT UNSIGNED NOT NULL,
 reset_member_count BIGINT UNSIGNED NOT NULL,
 reset_name_count BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_admin_guild_reset_request(request_key),
 UNIQUE KEY uq_admin_guild_reset_snapshot(snapshot_id),
 CONSTRAINT fk_admin_guild_reset_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_guild_reset_run_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_guild_reset_run_identity FOREIGN KEY(identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_guild_reset_run_snapshot FOREIGN KEY(snapshot_id) REFERENCES admin_guild_reset_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT chk_admin_guild_reset_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_guild_reset_restore_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operator_id BIGINT UNSIGNED NOT NULL,
 identity_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 generation_before BIGINT UNSIGNED NOT NULL,
 generation_after BIGINT UNSIGNED NOT NULL,
 restored_guild_count BIGINT UNSIGNED NOT NULL,
 restored_member_count BIGINT UNSIGNED NOT NULL,
 restored_name_count BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_admin_guild_reset_restore_request(request_key),
 UNIQUE KEY uq_admin_guild_reset_restore_snapshot(snapshot_id),
 CONSTRAINT fk_admin_guild_reset_restore_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_guild_reset_restore_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_guild_reset_restore_identity FOREIGN KEY(identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_guild_reset_restore_snapshot FOREIGN KEY(snapshot_id) REFERENCES admin_guild_reset_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT chk_admin_guild_reset_restore_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_GUILD_RESET_ALL','admin_guild_reset_all','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드전체초기화','ADMIN_GUILD_RESET_ALL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
