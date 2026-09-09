START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-RWD-022','티어 승급티켓🎟','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/티어보상지급'),TRUE,1),
('tier_advanced_ticket','고급 티어 승급티켓🎫','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/티어보상지급'),TRUE,1),
('pet_skill_book_fragment','펫스킬북 조각📙','STACK',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/티어보상지급'),TRUE,1),
('ITEM-RWD-053','다이아상자💎(/다이아상자오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/티어보상지급'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,metadata_json=JSON_MERGE_PATCH(metadata_json,VALUES(metadata_json));

CREATE TABLE tier_reward_payout_authorities(
 display_name VARCHAR(191) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tier_reward_payout_authorities(display_name,active)
VALUES('호이 남',TRUE),('오픈채팅봇',TRUE)
ON DUPLICATE KEY UPDATE active=TRUE;

CREATE TABLE tier_reward_payout_period_locks(
 period_key DATE NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tier_reward_score_rules(
 item_id BIGINT UNSIGNED NOT NULL,
 score_units BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(item_id),
 CONSTRAINT fk_tier_reward_score_rule_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_tier_reward_score_units CHECK(score_units>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tier_reward_score_rules(item_id,score_units,active)
SELECT id,CASE code WHEN 'ITEM-RWD-022' THEN 1 ELSE 300 END,TRUE
FROM item_definitions WHERE code IN('ITEM-RWD-022','tier_advanced_ticket')
ON DUPLICATE KEY UPDATE score_units=VALUES(score_units),active=TRUE;

CREATE TABLE tier_reward_rule_items(
 rank_no SMALLINT UNSIGNED NOT NULL,
 sequence_no SMALLINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 quantity BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(rank_no,sequence_no),
 UNIQUE KEY uq_tier_reward_rule_rank_item(rank_no,item_id),
 CONSTRAINT fk_tier_reward_rule_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_tier_reward_rule_rank CHECK(rank_no BETWEEN 1 AND 10),
 CONSTRAINT chk_tier_reward_rule_quantity CHECK(quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tier_reward_rule_items(rank_no,sequence_no,item_id,quantity,active)
SELECT source.rank_no,source.sequence_no,item.id,source.quantity,TRUE
FROM (
 SELECT 1 rank_no,1 sequence_no,'pet_skill_book_fragment' item_code,5 quantity UNION ALL
 SELECT 1,2,'ITEM-RWD-053',3 UNION ALL
 SELECT 2,1,'pet_skill_book_fragment',3 UNION ALL
 SELECT 2,2,'ITEM-RWD-053',2 UNION ALL
 SELECT 3,1,'pet_skill_book_fragment',2 UNION ALL
 SELECT 3,2,'ITEM-RWD-053',1 UNION ALL
 SELECT 4,1,'pet_skill_book_fragment',1 UNION ALL
 SELECT 4,2,'ITEM-RWD-053',1 UNION ALL
 SELECT 5,1,'ITEM-RWD-053',1 UNION ALL
 SELECT 6,1,'ITEM-RWD-053',1 UNION ALL
 SELECT 7,1,'ITEM-RWD-053',1 UNION ALL
 SELECT 8,1,'ITEM-RWD-053',1 UNION ALL
 SELECT 9,1,'ITEM-RWD-053',1 UNION ALL
 SELECT 10,1,'ITEM-RWD-053',1
) source
JOIN item_definitions item ON item.code=source.item_code
ON DUPLICATE KEY UPDATE item_id=VALUES(item_id),quantity=VALUES(quantity),active=TRUE;

CREATE TABLE tier_reward_snapshots(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 period_key DATE NOT NULL,
 operation_id BIGINT UNSIGNED NOT NULL,
 source_player_count BIGINT UNSIGNED NOT NULL,
 snapshot_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id),
 UNIQUE KEY uq_tier_reward_snapshot_period(period_key),
 UNIQUE KEY uq_tier_reward_snapshot_operation(operation_id),
 CONSTRAINT fk_tier_reward_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tier_reward_snapshot_entries(
 snapshot_id BIGINT UNSIGNED NOT NULL,
 rank_no BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 display_name VARCHAR(191) NOT NULL,
 regular_quantity BIGINT UNSIGNED NOT NULL,
 advanced_quantity BIGINT UNSIGNED NOT NULL,
 score BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(snapshot_id,rank_no),
 UNIQUE KEY uq_tier_reward_snapshot_player(snapshot_id,player_id),
 CONSTRAINT fk_tier_reward_entry_snapshot FOREIGN KEY(snapshot_id) REFERENCES tier_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT fk_tier_reward_entry_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tier_reward_payout_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period_key DATE NOT NULL,
 authority_identity_id BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 snapshot_entry_count BIGINT UNSIGNED NOT NULL,
 rewarded_player_count BIGINT UNSIGNED NOT NULL,
 grant_count BIGINT UNSIGNED NOT NULL,
 total_item_quantity BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_tier_reward_payout_request(request_key),
 UNIQUE KEY uq_tier_reward_payout_period(period_key),
 UNIQUE KEY uq_tier_reward_payout_snapshot(snapshot_id),
 CONSTRAINT fk_tier_reward_payout_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_tier_reward_payout_run_identity FOREIGN KEY(authority_identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_tier_reward_payout_run_snapshot FOREIGN KEY(snapshot_id) REFERENCES tier_reward_snapshots(id) ON DELETE RESTRICT,
 CONSTRAINT chk_tier_reward_payout_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tier_reward_payout_grants(
 operation_id BIGINT UNSIGNED NOT NULL,
 period_key DATE NOT NULL,
 rank_no SMALLINT UNSIGNED NOT NULL,
 sequence_no SMALLINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 quantity BIGINT UNSIGNED NOT NULL,
 balance_after BIGINT UNSIGNED NOT NULL,
 snapshot_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(operation_id,sequence_no),
 UNIQUE KEY uq_tier_reward_grant_period_player_item(period_key,player_id,item_id),
 CONSTRAINT fk_tier_reward_grant_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_tier_reward_grant_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_tier_reward_grant_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_tier_reward_grant_snapshot FOREIGN KEY(snapshot_id) REFERENCES tier_reward_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('TIER_REWARD_PAYOUT','tier_reward_payout','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/티어보상지급','TIER_REWARD_PAYOUT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
