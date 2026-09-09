START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-HOME-BADGE-GACHA-TICKET-1','홈뱃지뽑기🛡️(/홈뱃지오픈)','STACK',TRUE,JSON_OBJECT('legacyKey','홈뱃지뽑기🛡️(/홈뱃지오픈)','sourceContract','v2.400'),TRUE,1),
('ITEM-HOME-BADGE-GACHA-TICKET-2','홈뱃지뽑기🛡️[2](/홈뱃지오픈2)','STACK',TRUE,JSON_OBJECT('legacyKey','홈뱃지뽑기🛡️[2](/홈뱃지오픈2)','sourceContract','v2.400'),TRUE,1),
('ITEM-HOME-BADGE-GACHA-TICKET-3','홈뱃지뽑기🛡️[3](/홈뱃지오픈3)','STACK',TRUE,JSON_OBJECT('legacyKey','홈뱃지뽑기🛡️[3](/홈뱃지오픈3)','sourceContract','v2.400'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

CREATE TABLE home_badge_gacha_policies (
  variant_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  definition_version_id BIGINT UNSIGNED NOT NULL,
  default_count SMALLINT UNSIGNED NULL,
  minimum_count SMALLINT UNSIGNED NOT NULL,
  maximum_count SMALLINT UNSIGNED NOT NULL,
  duplicate_currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  duplicate_reward DECIMAL(30,3) NOT NULL,
  grade_draw BOOLEAN NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (variant_code),
  UNIQUE KEY uq_home_badge_gacha_command (command_code),
  CONSTRAINT fk_home_badge_gacha_ticket FOREIGN KEY (ticket_item_id) REFERENCES item_definitions(id),
  CONSTRAINT fk_home_badge_gacha_definition_version FOREIGN KEY (definition_version_id) REFERENCES home_badge_definition_versions(id),
  CONSTRAINT chk_home_badge_gacha_count CHECK (minimum_count >= 1 AND maximum_count >= minimum_count),
  CONSTRAINT chk_home_badge_gacha_duplicate_reward CHECK (duplicate_reward >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_gacha_grade_weights (
  variant_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_ordinal SMALLINT UNSIGNED NOT NULL,
  weight_value BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (variant_code,grade_code),
  UNIQUE KEY uq_home_badge_gacha_grade_order (variant_code,grade_ordinal),
  CONSTRAINT fk_home_badge_gacha_grade_policy FOREIGN KEY (variant_code) REFERENCES home_badge_gacha_policies(variant_code),
  CONSTRAINT chk_home_badge_gacha_grade_weight CHECK (weight_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_gacha_draw_results (
  operation_id BIGINT UNSIGNED NOT NULL,
  draw_ordinal SMALLINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  variant_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  definition_version_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  grade_sample DECIMAL(20,19) NULL,
  pool_sample DECIMAL(20,19) NOT NULL,
  result_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  point_reward DECIMAL(30,3) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,draw_ordinal),
  KEY idx_home_badge_gacha_player_created (player_id,created_at),
  KEY idx_home_badge_gacha_badge (definition_version_id,badge_code),
  CONSTRAINT fk_home_badge_gacha_result_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_badge_gacha_result_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_gacha_result_policy FOREIGN KEY (variant_code) REFERENCES home_badge_gacha_policies(variant_code),
  CONSTRAINT chk_home_badge_gacha_result_kind CHECK (result_kind IN ('new','duplicate','deleted')),
  CONSTRAINT chk_home_badge_gacha_result_reward CHECK (point_reward >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_badge_gacha_policies(variant_code,command_code,source_code,ticket_item_id,definition_version_id,default_count,minimum_count,maximum_count,duplicate_currency_code,duplicate_reward,grade_draw,active,version)
SELECT 'open1','HOME_BADGE_GACHA_OPEN_1','gacha',id,930000002,1,1,100,'point',100000000.000,TRUE,TRUE,1 FROM item_definitions WHERE code='ITEM-HOME-BADGE-GACHA-TICKET-1'
ON DUPLICATE KEY UPDATE source_code=VALUES(source_code),ticket_item_id=VALUES(ticket_item_id),definition_version_id=VALUES(definition_version_id),default_count=VALUES(default_count),minimum_count=VALUES(minimum_count),maximum_count=VALUES(maximum_count),duplicate_currency_code=VALUES(duplicate_currency_code),duplicate_reward=VALUES(duplicate_reward),grade_draw=VALUES(grade_draw),active=TRUE,version=home_badge_gacha_policies.version+1;
INSERT INTO home_badge_gacha_policies(variant_code,command_code,source_code,ticket_item_id,definition_version_id,default_count,minimum_count,maximum_count,duplicate_currency_code,duplicate_reward,grade_draw,active,version)
SELECT 'open2','HOME_BADGE_GACHA_OPEN_2','mbti',id,930000002,NULL,1,100,'point',100000000.000,FALSE,TRUE,1 FROM item_definitions WHERE code='ITEM-HOME-BADGE-GACHA-TICKET-2'
ON DUPLICATE KEY UPDATE source_code=VALUES(source_code),ticket_item_id=VALUES(ticket_item_id),definition_version_id=VALUES(definition_version_id),default_count=VALUES(default_count),minimum_count=VALUES(minimum_count),maximum_count=VALUES(maximum_count),duplicate_currency_code=VALUES(duplicate_currency_code),duplicate_reward=VALUES(duplicate_reward),grade_draw=VALUES(grade_draw),active=TRUE,version=home_badge_gacha_policies.version+1;
INSERT INTO home_badge_gacha_policies(variant_code,command_code,source_code,ticket_item_id,definition_version_id,default_count,minimum_count,maximum_count,duplicate_currency_code,duplicate_reward,grade_draw,active,version)
SELECT 'open3','HOME_BADGE_GACHA_OPEN_3','love',id,930000002,1,1,100,'point',100000000.000,FALSE,TRUE,1 FROM item_definitions WHERE code='ITEM-HOME-BADGE-GACHA-TICKET-3'
ON DUPLICATE KEY UPDATE source_code=VALUES(source_code),ticket_item_id=VALUES(ticket_item_id),definition_version_id=VALUES(definition_version_id),default_count=VALUES(default_count),minimum_count=VALUES(minimum_count),maximum_count=VALUES(maximum_count),duplicate_currency_code=VALUES(duplicate_currency_code),duplicate_reward=VALUES(duplicate_reward),grade_draw=VALUES(grade_draw),active=TRUE,version=home_badge_gacha_policies.version+1;

INSERT INTO home_badge_gacha_grade_weights(variant_code,grade_code,grade_ordinal,weight_value) VALUES
('open1','C',1,55),('open1','B',2,30),('open1','A',3,12),('open1','S',4,3)
ON DUPLICATE KEY UPDATE grade_ordinal=VALUES(grade_ordinal),weight_value=VALUES(weight_value);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('HOME_BADGE_GACHA_OPEN_1','home_badge_gacha_open','VERIFIED_USER','SHADOW',TRUE,1),
('HOME_BADGE_GACHA_OPEN_2','home_badge_gacha_open','VERIFIED_USER','SHADOW',TRUE,1),
('HOME_BADGE_GACHA_OPEN_3','home_badge_gacha_open','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/홈뱃지오픈','HOME_BADGE_GACHA_OPEN_1',TRUE),('/홈뱃지오픈2','HOME_BADGE_GACHA_OPEN_2',TRUE),('/홈뱃지오픈3','HOME_BADGE_GACHA_OPEN_3',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
