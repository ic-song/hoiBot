START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('pet_enhance_stone','펫 강화석⭐','STACK',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/연금지급'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,metadata_json=JSON_MERGE_PATCH(metadata_json,VALUES(metadata_json));

CREATE TABLE mini_pet_rank_reward_authorities(
 display_name VARCHAR(191) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_rank_reward_authorities(display_name,active)
VALUES('호이 남',TRUE),('오픈채팅봇',TRUE)
ON DUPLICATE KEY UPDATE active=TRUE;

CREATE TABLE mini_pet_rank_reward_period_locks(
 period_key DATE NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_rank_reward_rules(
 rank_start SMALLINT UNSIGNED NOT NULL,
 rank_end SMALLINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(rank_start),
 UNIQUE KEY uq_mini_pet_rank_reward_end(rank_end),
 CONSTRAINT chk_mini_pet_rank_reward_range CHECK(rank_start>=1 AND rank_end>=rank_start AND rank_end<=200),
 CONSTRAINT chk_mini_pet_rank_reward_quantity CHECK(reward_quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_rank_reward_rules(rank_start,rank_end,reward_quantity,active) VALUES
(1,1,40,TRUE),(2,2,30,TRUE),(3,3,25,TRUE),(4,4,24,TRUE),(5,5,23,TRUE),
(6,6,22,TRUE),(7,7,21,TRUE),(8,8,20,TRUE),(9,9,19,TRUE),(10,10,18,TRUE),
(11,20,17,TRUE),(21,30,16,TRUE),(31,40,15,TRUE),(41,50,14,TRUE),(51,60,13,TRUE),
(61,70,12,TRUE),(71,80,11,TRUE),(81,90,10,TRUE),(91,100,9,TRUE),(101,110,8,TRUE),
(111,120,7,TRUE),(121,130,6,TRUE),(131,140,5,TRUE),(141,150,4,TRUE),(151,160,3,TRUE),
(161,170,2,TRUE),(171,200,1,TRUE)
ON DUPLICATE KEY UPDATE rank_end=VALUES(rank_end),reward_quantity=VALUES(reward_quantity),active=TRUE;

CREATE TABLE mini_pet_rank_reward_snapshots(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 period_key DATE NOT NULL,
 operation_id BIGINT UNSIGNED NOT NULL,
 source_player_count BIGINT UNSIGNED NOT NULL,
 snapshot_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_mini_pet_rank_reward_snapshot_period(period_key),
 UNIQUE KEY uq_mini_pet_rank_reward_snapshot_operation(operation_id),
 CONSTRAINT fk_mini_pet_rank_reward_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_rank_reward_snapshot_entries(
 snapshot_id BIGINT UNSIGNED NOT NULL,
 rank_no BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 display_name VARCHAR(191) NOT NULL,
 equipped_charm BIGINT UNSIGNED NOT NULL,
 bag_charm BIGINT UNSIGNED NOT NULL,
 bag_pet_count BIGINT UNSIGNED NOT NULL,
 total_charm BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(snapshot_id,rank_no),
 UNIQUE KEY uq_mini_pet_rank_reward_snapshot_player(snapshot_id,player_id),
 CONSTRAINT fk_mini_pet_rank_reward_entry_snapshot FOREIGN KEY(snapshot_id) REFERENCES mini_pet_rank_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_rank_reward_entry_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_rank_reward_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period_key DATE NOT NULL,
 authority_identity_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 snapshot_entry_count BIGINT UNSIGNED NOT NULL,
 rewarded_player_count BIGINT UNSIGNED NOT NULL,
 total_reward_quantity BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_mini_pet_rank_reward_request(request_key),
 UNIQUE KEY uq_mini_pet_rank_reward_period(period_key),
 UNIQUE KEY uq_mini_pet_rank_reward_snapshot(snapshot_id),
 CONSTRAINT fk_mini_pet_rank_reward_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_rank_reward_run_identity FOREIGN KEY(authority_identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_rank_reward_run_snapshot FOREIGN KEY(snapshot_id) REFERENCES mini_pet_rank_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT chk_mini_pet_rank_reward_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_rank_reward_grants(
 operation_id BIGINT UNSIGNED NOT NULL,
 period_key DATE NOT NULL,
 rank_no SMALLINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 balance_after BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(operation_id,rank_no),
 UNIQUE KEY uq_mini_pet_rank_reward_grant_player(operation_id,player_id),
 UNIQUE KEY uq_mini_pet_rank_reward_grant_period_player(period_key,player_id),
 CONSTRAINT fk_mini_pet_rank_reward_grant_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_rank_reward_grant_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_rank_reward_grant_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_rank_reward_grant_snapshot FOREIGN KEY(snapshot_id) REFERENCES mini_pet_rank_reward_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_RANK_REWARD_PAYOUT','mini_pet_rank_reward_payout','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/연금지급','MINI_PET_RANK_REWARD_PAYOUT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
