START TRANSACTION;

CREATE TABLE player_title_instances(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 instance_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 title_id BIGINT UNSIGNED NOT NULL,
 source_operation_id BIGINT UNSIGNED NOT NULL,
 source_sequence_no BIGINT UNSIGNED NOT NULL,
 price_value DECIMAL(30,3) NOT NULL DEFAULT 0,
 display_order BIGINT UNSIGNED NOT NULL,
 status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
 equipped BOOLEAN NOT NULL DEFAULT FALSE,
 acquired_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 PRIMARY KEY(id),
 UNIQUE KEY uq_player_title_instance_key(instance_key),
 UNIQUE KEY uq_player_title_instance_operation(source_operation_id,source_sequence_no),
 UNIQUE KEY uq_player_title_instance_order(player_id,display_order),
 KEY idx_player_title_instance_owner(player_id,title_id,status),
 CONSTRAINT fk_player_title_instance_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_player_title_instance_title FOREIGN KEY(title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_player_title_instance_operation FOREIGN KEY(source_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE baseball_pitch_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 use_count BIGINT UNSIGNED NOT NULL,
 hit_count BIGINT UNSIGNED NOT NULL,
 double_count BIGINT UNSIGNED NOT NULL,
 triple_count BIGINT UNSIGNED NOT NULL,
 homerun_count BIGINT UNSIGNED NOT NULL,
 grand_slam_count BIGINT UNSIGNED NOT NULL,
 point_reward DECIMAL(30,3) NOT NULL,
 ball_remaining BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 KEY idx_baseball_pitch_player_created(player_id,created_at),
 CONSTRAINT fk_baseball_pitch_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_baseball_pitch_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE baseball_pitch_rng_samples(
 operation_id BIGINT UNSIGNED NOT NULL,
 sequence_no INT UNSIGNED NOT NULL,
 sample_value DECIMAL(20,19) NOT NULL,
 outcome_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(operation_id,sequence_no),
 CONSTRAINT fk_baseball_pitch_rng_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-RWD-014','호이베이스볼⚾️(/투수던집니다)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/투수던집니다'),TRUE,1),
('ITEM-RWD-001','펫스윗홈인테리어샵🖼️(/샵오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1),
('ITEM-ELEMENTAL-UPGRADE-STONE','정령 강화석🥀','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1),
('ITEM-RWD-026','펫 강화석⭐','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,active=TRUE;

INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES
('TITLE-BASEBALL-GRAND-SLAM','⚾️그랜드슬램을 달성한 선수🏆','player',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scope_code='player',active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('HOME_BASEBALL_PITCH','home_baseball_pitch','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/투수던집니다','HOME_BASEBALL_PITCH',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
