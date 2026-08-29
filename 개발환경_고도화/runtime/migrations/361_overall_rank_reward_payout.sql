START TRANSACTION;

CREATE TABLE IF NOT EXISTS overall_rank_reward_policies(
 policy_version BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 policy_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reward_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
 maximum_rank SMALLINT UNSIGNED NOT NULL DEFAULT 150,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(policy_version),
 KEY idx_overall_rank_reward_policy_active(policy_key,reward_type,enabled,policy_version),
 CONSTRAINT fk_overall_rank_reward_policy_item FOREIGN KEY(item_code) REFERENCES item_definitions(code) ON DELETE RESTRICT,
 CONSTRAINT chk_overall_rank_reward_maximum_rank CHECK(maximum_rank BETWEEN 1 AND 150)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO overall_rank_reward_policies(policy_version,policy_key,reward_type,item_code,maximum_rank,enabled)
VALUES(1,'daily_overall_rank','overall','pet_enhance_stone',150,FALSE)
ON DUPLICATE KEY UPDATE policy_key=VALUES(policy_key),reward_type=VALUES(reward_type),item_code=VALUES(item_code),maximum_rank=VALUES(maximum_rank);

CREATE TABLE IF NOT EXISTS overall_rank_reward_rules(
 policy_version BIGINT UNSIGNED NOT NULL,
 rank_start SMALLINT UNSIGNED NOT NULL,
 rank_end SMALLINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(policy_version,rank_start),
 CONSTRAINT fk_overall_rank_reward_rule_policy FOREIGN KEY(policy_version) REFERENCES overall_rank_reward_policies(policy_version) ON DELETE RESTRICT,
 CONSTRAINT chk_overall_rank_reward_rule_range CHECK(rank_start BETWEEN 1 AND 150 AND rank_end BETWEEN rank_start AND 150),
 CONSTRAINT chk_overall_rank_reward_rule_quantity CHECK(reward_quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_operator_allowlist(
 operator_id BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operator_id),
 CONSTRAINT fk_overall_rank_reward_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_destinations(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 destination_id VARCHAR(191) NOT NULL,
 display_order INT UNSIGNED NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_overall_rank_reward_destination(destination_id),
 KEY idx_overall_rank_reward_destination_active(active,display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_period_locks(
 period_key DATE NOT NULL,
 reward_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(period_key,reward_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_snapshots(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 operation_id BIGINT UNSIGNED NOT NULL,
 snapshot_version BIGINT UNSIGNED NOT NULL,
 input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 policy_version BIGINT UNSIGNED NOT NULL,
 eligible_player_count INT UNSIGNED NOT NULL,
 entry_count SMALLINT UNSIGNED NOT NULL,
 snapshot_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_overall_rank_reward_snapshot_operation(operation_id),
 UNIQUE KEY uq_overall_rank_reward_snapshot_version(snapshot_version),
 CONSTRAINT fk_overall_rank_reward_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_snapshot_policy FOREIGN KEY(policy_version) REFERENCES overall_rank_reward_policies(policy_version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_snapshot_entries(
 snapshot_id BIGINT UNSIGNED NOT NULL,
 ordinal_value SMALLINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 display_name_snapshot VARCHAR(191) NOT NULL,
 source_order BIGINT UNSIGNED NULL,
 total_charm BIGINT UNSIGNED NOT NULL,
 castle_charm BIGINT UNSIGNED NOT NULL,
 raid_charm BIGINT UNSIGNED NOT NULL,
 effective_enhancement BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(snapshot_id,ordinal_value),
 UNIQUE KEY uq_overall_rank_reward_snapshot_player(snapshot_id,player_id),
 CONSTRAINT fk_overall_rank_reward_entry_snapshot FOREIGN KEY(snapshot_id) REFERENCES overall_rank_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_entry_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT chk_overall_rank_reward_entry_ordinal CHECK(ordinal_value BETWEEN 1 AND 150)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period_key DATE NOT NULL,
 reward_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 authority_operator_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 policy_version BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 recipient_count SMALLINT UNSIGNED NOT NULL,
 total_reward_quantity BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_overall_rank_reward_request(request_key),
 UNIQUE KEY uq_overall_rank_reward_period(period_key,reward_type),
 CONSTRAINT fk_overall_rank_reward_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_run_operator FOREIGN KEY(authority_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_run_snapshot FOREIGN KEY(snapshot_id) REFERENCES overall_rank_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_run_policy FOREIGN KEY(policy_version) REFERENCES overall_rank_reward_policies(policy_version) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_run_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_overall_rank_reward_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_recipients(
 operation_id BIGINT UNSIGNED NOT NULL,
 ordinal_value SMALLINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 balance_before BIGINT UNSIGNED NOT NULL,
 balance_after BIGINT UNSIGNED NOT NULL,
 inventory_ledger_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(operation_id,ordinal_value),
 UNIQUE KEY uq_overall_rank_reward_recipient_player(operation_id,player_id),
 CONSTRAINT fk_overall_rank_reward_recipient_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_recipient_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_recipient_snapshot FOREIGN KEY(snapshot_id) REFERENCES overall_rank_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_recipient_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_recipient_ledger FOREIGN KEY(inventory_ledger_id) REFERENCES inventory_ledger(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overall_rank_reward_status(
 player_id BIGINT UNSIGNED NOT NULL,
 reward_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 last_period_key DATE NOT NULL,
 last_operation_id BIGINT UNSIGNED NOT NULL,
 last_snapshot_id BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(player_id,reward_type),
 CONSTRAINT fk_overall_rank_reward_status_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_status_operation FOREIGN KEY(last_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_overall_rank_reward_status_snapshot FOREIGN KEY(last_snapshot_id) REFERENCES overall_rank_reward_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('OVERALL_RANK_REWARD_PAYOUT','admin.overall_rank_reward.payout','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/보상지급','OVERALL_RANK_REWARD_PAYOUT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
