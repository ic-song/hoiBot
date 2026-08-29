START TRANSACTION;

CREATE TABLE IF NOT EXISTS guild_rank_reward_policies(
 policy_version BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 policy_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
 maximum_rank SMALLINT UNSIGNED NOT NULL DEFAULT 20,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(policy_version),
 KEY idx_guild_rank_reward_policy_active(policy_key,enabled,policy_version),
 CONSTRAINT fk_guild_rank_reward_policy_item FOREIGN KEY(item_code) REFERENCES item_definitions(code) ON DELETE RESTRICT,
 CONSTRAINT chk_guild_rank_reward_maximum_rank CHECK(maximum_rank BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO guild_rank_reward_policies(policy_version,policy_key,item_code,maximum_rank,enabled)
VALUES(1,'daily_guild_rank',NULL,20,FALSE)
ON DUPLICATE KEY UPDATE policy_key=VALUES(policy_key),maximum_rank=VALUES(maximum_rank);

CREATE TABLE IF NOT EXISTS guild_rank_reward_rules(
 policy_version BIGINT UNSIGNED NOT NULL,
 ordinal_value SMALLINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(policy_version,ordinal_value),
 CONSTRAINT fk_guild_rank_reward_rule_policy FOREIGN KEY(policy_version) REFERENCES guild_rank_reward_policies(policy_version) ON DELETE RESTRICT,
 CONSTRAINT chk_guild_rank_reward_rule_ordinal CHECK(ordinal_value BETWEEN 1 AND 20),
 CONSTRAINT chk_guild_rank_reward_rule_quantity CHECK(reward_quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_operator_allowlist(
 operator_id BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operator_id),
 CONSTRAINT fk_guild_rank_reward_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_destinations(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 destination_id VARCHAR(191) NOT NULL,
 destination_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 display_order INT UNSIGNED NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_guild_rank_reward_destination(destination_id,destination_kind),
 KEY idx_guild_rank_reward_destination_active(destination_kind,active,display_order),
 CONSTRAINT chk_guild_rank_reward_destination_kind CHECK(destination_kind IN('operator','notice'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_schedules(
 schedule_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 timezone_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 local_run_time TIME NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(schedule_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_schedule_jobs(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 schedule_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period_key DATE NOT NULL,
 snapshot_id BIGINT UNSIGNED NULL,
 policy_version BIGINT UNSIGNED NULL,
 status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
 available_at DATETIME(3) NOT NULL,
 claim_owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
 claim_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 lease_until DATETIME(3) NULL,
 attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
 last_error_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
 operation_id BIGINT UNSIGNED NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_guild_rank_reward_schedule_period(schedule_key,period_key),
 UNIQUE KEY uq_guild_rank_reward_schedule_claim(claim_token),
 KEY idx_guild_rank_reward_schedule_due(status,available_at,lease_until),
 CONSTRAINT fk_guild_rank_reward_job_schedule FOREIGN KEY(schedule_key) REFERENCES guild_rank_reward_schedules(schedule_key) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_job_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_job_policy FOREIGN KEY(policy_version) REFERENCES guild_rank_reward_policies(policy_version) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_job_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT chk_guild_rank_reward_job_status CHECK(status IN('PENDING','RUNNING','RETRY','COMPLETED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_period_locks(
 period_key DATE NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period_key DATE NOT NULL,
 source_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 authority_operator_id BIGINT UNSIGNED NULL,
 schedule_job_id BIGINT UNSIGNED NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 snapshot_version BIGINT UNSIGNED NOT NULL,
 snapshot_input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 policy_version BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ranked_guild_count SMALLINT UNSIGNED NOT NULL,
 recipient_count INT UNSIGNED NOT NULL,
 total_reward_quantity BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_guild_rank_reward_request(request_key),
 UNIQUE KEY uq_guild_rank_reward_period(period_key),
 UNIQUE KEY uq_guild_rank_reward_schedule_job(schedule_job_id),
 CONSTRAINT fk_guild_rank_reward_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_run_operator FOREIGN KEY(authority_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_run_job FOREIGN KEY(schedule_job_id) REFERENCES guild_rank_reward_schedule_jobs(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_run_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_run_policy FOREIGN KEY(policy_version) REFERENCES guild_rank_reward_policies(policy_version) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_run_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_guild_rank_reward_source CHECK(source_kind IN('manual','schedule')),
 CONSTRAINT chk_guild_rank_reward_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_reward_recipients(
 operation_id BIGINT UNSIGNED NOT NULL,
 sequence_no INT UNSIGNED NOT NULL,
 ordinal_value SMALLINT UNSIGNED NOT NULL,
 guild_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 balance_before BIGINT UNSIGNED NOT NULL,
 balance_after BIGINT UNSIGNED NOT NULL,
 inventory_ledger_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(operation_id,sequence_no),
 UNIQUE KEY uq_guild_rank_reward_recipient_player(operation_id,player_id),
 CONSTRAINT fk_guild_rank_reward_recipient_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_recipient_member FOREIGN KEY(guild_id,player_id) REFERENCES guild_members(guild_id,player_id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_recipient_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_recipient_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_guild_rank_reward_recipient_ledger FOREIGN KEY(inventory_ledger_id) REFERENCES inventory_ledger(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_RANK_REWARD_PAYOUT','guild.rank_reward.payout','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드보상지급','GUILD_RANK_REWARD_PAYOUT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
