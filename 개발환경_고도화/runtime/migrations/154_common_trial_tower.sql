START TRANSACTION;

CREATE TABLE trial_tower_seasons (
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  max_daily_attempts INT UNSIGNED NOT NULL DEFAULT 15,
  auto_bonus_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  free_floor_max BIGINT UNSIGNED NOT NULL DEFAULT 5,
  paid_entry_point DECIMAL(30,3) NOT NULL DEFAULT 5500000,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (season_key), KEY idx_trial_tower_season_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trial_tower_progress (
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  floor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_win_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (season_key,player_id),
  CONSTRAINT fk_trial_progress_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_progress_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trial_tower_boss_bands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  boss_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  min_floor BIGINT UNSIGNED NOT NULL,
  max_floor BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  pet_type_name VARCHAR(64) NULL,
  rewards_json JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_trial_boss_band (season_key,boss_code),
  KEY idx_trial_boss_floor (season_key,min_floor,max_floor,active),
  CONSTRAINT fk_trial_boss_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trial_tower_event_bosses (
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  floor BIGINT UNSIGNED NOT NULL,
  boss_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  pet_type_name VARCHAR(64) NULL,
  rewards_json JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (season_key,floor),
  CONSTRAINT fk_trial_event_boss_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trial_tower_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  floor BIGINT UNSIGNED NOT NULL,
  boss_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  direct_win BOOLEAN NOT NULL DEFAULT FALSE,
  player_charm BIGINT UNSIGNED NOT NULL,
  player_final_charm BIGINT UNSIGNED NOT NULL,
  boss_charm BIGINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL DEFAULT 0,
  reset_ticket_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
  guide_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
  booster_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
  junk_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  triggered_skill VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_trial_attempt_operation (operation_id),
  CONSTRAINT fk_trial_attempt_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_attempt_season FOREIGN KEY (season_key) REFERENCES trial_tower_seasons(season_key) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_attempt_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trial_tower_rng_samples (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  sample_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sample_value DECIMAL(20,17) NOT NULL,
  outcome_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (operation_id,sequence_no),
  CONSTRAINT fk_trial_rng_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO trial_tower_seasons(season_key,active) VALUES ('current',TRUE)
  ON DUPLICATE KEY UPDATE active=VALUES(active),version=version+1;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active)
VALUES ('trial_reset_ticket','시련의탑리셋권','item',TRUE,JSON_OBJECT('synthetic',TRUE),TRUE),
       ('trial_guide','시탑 공략서','item',TRUE,JSON_OBJECT('synthetic',TRUE),TRUE),
       ('trial_booster','시탑 부스터','item',TRUE,JSON_OBJECT('synthetic',TRUE),TRUE),
       ('trial_junk','잡동사니','item',TRUE,JSON_OBJECT('synthetic',TRUE),TRUE),
       ('trial_magic_stone','마정석','item',TRUE,JSON_OBJECT('synthetic',TRUE),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE,version=version+1;
INSERT INTO skill_definitions(code,display_name,rules_json,active)
VALUES ('trial_salvation','구원',JSON_OBJECT('chance',0.5,'charm',500000),TRUE),
       ('trial_ten_won','십원',JSON_OBJECT('chance',0.4,'charm',1000000),TRUE),
       ('trial_walker','시련을 걷는 자',JSON_OBJECT('chance',0.1),TRUE),
       ('trial_worshipper','탑 숭배자',JSON_OBJECT('chance',0.1,'petExperience',1),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),rules_json=VALUES(rules_json),active=TRUE;
INSERT INTO title_definitions(code,display_name,scope_code,active)
VALUES ('trial_floor_10000','시련의 탑 10000층 정복자','player',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;
INSERT INTO trial_tower_boss_bands(season_key,boss_code,min_floor,max_floor,display_name,pet_type_name,rewards_json,active)
VALUES ('current','synthetic-boss',1,1000000000,'합성 시련 보스','땅',JSON_ARRAY(JSON_OBJECT('itemCode','trial_magic_stone','quantity',1,'boostable',TRUE)),TRUE)
ON DUPLICATE KEY UPDATE min_floor=VALUES(min_floor),max_floor=VALUES(max_floor),display_name=VALUES(display_name),pet_type_name=VALUES(pet_type_name),rewards_json=VALUES(rewards_json),active=TRUE;

COMMIT;
