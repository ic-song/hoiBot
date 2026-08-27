START TRANSACTION;

CREATE TABLE legendary_stone_draw_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 use_count BIGINT UNSIGNED NOT NULL,
 stone_1_count BIGINT UNSIGNED NOT NULL,
 stone_2_count BIGINT UNSIGNED NOT NULL,
 stone_3_count BIGINT UNSIGNED NOT NULL,
 stone_5_count BIGINT UNSIGNED NOT NULL,
 stone_10_count BIGINT UNSIGNED NOT NULL,
 stone_50_count BIGINT UNSIGNED NOT NULL,
 total_stone_reward BIGINT UNSIGNED NOT NULL,
 ticket_remaining BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 KEY idx_legendary_stone_draw_player_created(player_id,created_at),
 CONSTRAINT fk_legendary_stone_draw_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_legendary_stone_draw_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legendary_stone_draw_rng_samples(
 operation_id BIGINT UNSIGNED NOT NULL,
 sequence_no INT UNSIGNED NOT NULL,
 sample_value DECIMAL(20,19) NOT NULL,
 outcome_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 outcome_quantity BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(operation_id,sequence_no),
 CONSTRAINT fk_legendary_stone_draw_rng_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-LEGENDARY-STONE-DRAW-TICKET','전설의돌 뽑기🩶[2](/전돌뽑기 숫자)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/전돌뽑기','gate8Snapshot','pending'),TRUE,1),
('ITEM-RWD-022','티어 승급티켓🎟','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1),
('ITEM-RWD-053','다이아상자💎(/다이아상자오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1),
('ITEM-RWD-001','펫스윗홈인테리어샵🖼️(/샵오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1),
('ITEM-RWD-052','전설의 돌맹이🗿','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('LEGENDARY_STONE_DRAW','legendary_stone_draw','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/전돌뽑기','LEGENDARY_STONE_DRAW',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
