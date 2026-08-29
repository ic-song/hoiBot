START TRANSACTION;

CREATE TABLE IF NOT EXISTS punch_action_state(
 state_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 next_source_order BIGINT UNSIGNED NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(state_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO punch_action_state(state_key,next_source_order,version)
SELECT 'default',COALESCE(MAX(source_order),0)+1,1 FROM player_punch_rank_stats
ON DUPLICATE KEY UPDATE state_key=VALUES(state_key);

CREATE TABLE IF NOT EXISTS punch_action_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 identity_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 requested_count BIGINT UNSIGNED NOT NULL,
 clamped_count BIGINT UNSIGNED NOT NULL,
 executed_count BIGINT UNSIGNED NOT NULL,
 ticket_quantity_before BIGINT UNSIGNED NOT NULL,
 ticket_quantity_after BIGINT UNSIGNED NOT NULL,
 point_balance_before DECIMAL(30,3) NOT NULL,
 point_balance_after DECIMAL(30,3) NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 legend_count BIGINT UNSIGNED NOT NULL,
 title_granted BOOLEAN NOT NULL,
 result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_punch_action_request(request_key),
 KEY ix_punch_action_player_created(player_id,created_at),
 CONSTRAINT fk_punch_action_run_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_punch_action_run_identity FOREIGN KEY(identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_punch_action_run_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT chk_punch_action_count CHECK(clamped_count<=100 AND executed_count<=clamped_count),
 CONSTRAINT chk_punch_action_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS punch_action_rounds(
 operation_id BIGINT UNSIGNED NOT NULL,
 sequence_no INT UNSIGNED NOT NULL,
 tier_sample DECIMAL(20,19) NOT NULL,
 score_sample DECIMAL(20,19) NOT NULL,
 outcome_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 rank_name VARCHAR(96) NOT NULL,
 score BIGINT UNSIGNED NOT NULL,
 reward_quantity BIGINT UNSIGNED NOT NULL,
 legend BOOLEAN NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id,sequence_no),
 CONSTRAINT fk_punch_action_round_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT chk_punch_action_round_sequence CHECK(sequence_no BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('punch_ticket','핵꿀밤🥊(/펀치)','ITEM',TRUE,JSON_OBJECT('sourceContract','v2.400','consumerCommand','/펀치'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='ITEM',stackable=TRUE,active=TRUE;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('mini_pet_draw','미니펫뽑기🐹(/미니펫오픈)','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','producerCommand','/펀치'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE;

INSERT INTO title_definitions(code,display_name,scope_code,active)
VALUES('TITLE-PUNCH-LEGEND','👑전설의 핵주먹','player',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scope_code='player',active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PUNCH_ACTION','punch_action','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펀치','PUNCH_ACTION',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
