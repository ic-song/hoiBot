START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-HOME-BADGE-CUBE','홈뱃지 큐브💟','STACK',TRUE,JSON_OBJECT('legacyKey','홈뱃지 큐브💟','sourceContract','v2.400'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

CREATE TABLE home_badge_cube_config_versions (
  id BIGINT UNSIGNED NOT NULL, definition_version_id BIGINT UNSIGNED NOT NULL,
  source_contract VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_home_badge_cube_config_hash (content_hash),
  CONSTRAINT fk_home_badge_cube_config_definition FOREIGN KEY (definition_version_id) REFERENCES home_badge_definition_versions(id),
  CONSTRAINT chk_home_badge_cube_config_status CHECK (status IN ('draft','shadow','active','retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_options (
  config_version_id BIGINT UNSIGNED NOT NULL, option_number TINYINT UNSIGNED NOT NULL,
  option_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  emoji_value VARCHAR(32) NOT NULL, display_name VARCHAR(64) NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL, cost_quantity BIGINT UNSIGNED NOT NULL, maximum_tenths SMALLINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (config_version_id,option_number), UNIQUE KEY uq_home_badge_cube_option_code (config_version_id,option_code),
  CONSTRAINT fk_home_badge_cube_option_config FOREIGN KEY (config_version_id) REFERENCES home_badge_cube_config_versions(id),
  CONSTRAINT fk_home_badge_cube_option_item FOREIGN KEY (item_id) REFERENCES item_definitions(id),
  CONSTRAINT chk_home_badge_cube_option_number CHECK (option_number BETWEEN 1 AND 4),
  CONSTRAINT chk_home_badge_cube_option_values CHECK (cost_quantity > 0 AND maximum_tenths > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_rate_bands (
  config_version_id BIGINT UNSIGNED NOT NULL, band_ordinal SMALLINT UNSIGNED NOT NULL,
  minimum_tenths SMALLINT UNSIGNED NOT NULL, maximum_tenths SMALLINT UNSIGNED NOT NULL, weight_value BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (config_version_id,band_ordinal),
  CONSTRAINT fk_home_badge_cube_rate_config FOREIGN KEY (config_version_id) REFERENCES home_badge_cube_config_versions(id),
  CONSTRAINT chk_home_badge_cube_rate_values CHECK (maximum_tenths >= minimum_tenths AND weight_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_executions (
  operation_id BIGINT UNSIGNED NOT NULL, player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, config_version_id BIGINT UNSIGNED NOT NULL,
  option_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_count SMALLINT UNSIGNED NOT NULL, used_count SMALLINT UNSIGNED NOT NULL, consumed_quantity BIGINT UNSIGNED NOT NULL,
  before_tenths SMALLINT UNSIGNED NOT NULL, after_tenths SMALLINT UNSIGNED NOT NULL, last_roll_tenths SMALLINT UNSIGNED NOT NULL,
  upgrade_count SMALLINT UNSIGNED NOT NULL, protected_count SMALLINT UNSIGNED NOT NULL, all_max_notice BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id), KEY idx_home_badge_cube_execution_player (player_id,created_at),
  CONSTRAINT fk_home_badge_cube_execution_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_badge_cube_execution_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_cube_execution_config FOREIGN KEY (config_version_id) REFERENCES home_badge_cube_config_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_rolls (
  operation_id BIGINT UNSIGNED NOT NULL, roll_ordinal SMALLINT UNSIGNED NOT NULL, band_ordinal SMALLINT UNSIGNED NOT NULL,
  band_sample DECIMAL(20,19) NOT NULL, value_sample DECIMAL(20,19) NOT NULL, rolled_tenths SMALLINT UNSIGNED NOT NULL,
  before_tenths SMALLINT UNSIGNED NOT NULL, protection_floor_tenths SMALLINT UNSIGNED NOT NULL,
  next_target_tenths SMALLINT UNSIGNED NOT NULL, stage_ceiling_tenths SMALLINT UNSIGNED NOT NULL, applied_tenths SMALLINT UNSIGNED NOT NULL,
  result_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,roll_ordinal),
  CONSTRAINT fk_home_badge_cube_roll_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_home_badge_cube_roll_kind CHECK (result_kind IN ('upgrade','protected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_milestones (
  player_id BIGINT UNSIGNED NOT NULL, badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  option_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, milestone_percent SMALLINT UNSIGNED NOT NULL,
  source_operation_id BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id,badge_code,option_code,milestone_percent),
  CONSTRAINT fk_home_badge_cube_milestone_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_cube_milestone_operation FOREIGN KEY (source_operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_badge_cube_all_max_notices (
  player_id BIGINT UNSIGNED NOT NULL, badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_operation_id BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id,badge_code),
  CONSTRAINT fk_home_badge_cube_allmax_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_cube_allmax_operation FOREIGN KEY (source_operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_badge_cube_config_versions(id,definition_version_id,source_contract,content_hash,status,effective_at)
VALUES (930000003,930000002,'v2.400',SHA2('v2.400|HOME_BADGE_CUBE|1:castle:1:500|2:raid:1:500|3:petUpgrade:2:300|4:explore:3:150|51-rates',256),'shadow','2026-08-30 00:00:00.000');

INSERT INTO home_badge_cube_options(config_version_id,option_number,option_code,emoji_value,display_name,item_id,cost_quantity,maximum_tenths,active)
SELECT 930000003,1,'castle','⚔️','캐슬 매력',id,1,500,TRUE FROM item_definitions WHERE code='ITEM-HOME-BADGE-CUBE'
UNION ALL SELECT 930000003,2,'raid','👾','레이드 매력',id,1,500,TRUE FROM item_definitions WHERE code='ITEM-HOME-BADGE-CUBE'
UNION ALL SELECT 930000003,3,'petUpgrade','🌟','펫 강화 수치',id,2,300,TRUE FROM item_definitions WHERE code='ITEM-HOME-BADGE-CUBE'
UNION ALL SELECT 930000003,4,'explore','⛰️','펫 탐험 확률',id,3,150,TRUE FROM item_definitions WHERE code='ITEM-HOME-BADGE-CUBE';

INSERT INTO home_badge_cube_rate_bands(config_version_id,band_ordinal,minimum_tenths,maximum_tenths,weight_value) VALUES
(930000003,1,10,19,45967600),(930000003,2,20,29,31030000),(930000003,3,30,39,15320000),(930000003,4,40,49,5210000),(930000003,5,50,59,1709000),
(930000003,6,60,69,350000),(930000003,7,70,79,180000),(930000003,8,80,89,80000),(930000003,9,90,99,30000),(930000003,10,100,100,1000),
(930000003,11,101,109,10000),(930000003,12,110,119,10000),(930000003,13,120,129,10000),(930000003,14,130,139,10000),(930000003,15,140,149,10000),
(930000003,16,150,159,5000),(930000003,17,160,169,5000),(930000003,18,170,179,5000),(930000003,19,180,189,5000),(930000003,20,190,199,5000),
(930000003,21,200,209,2000),(930000003,22,210,219,2000),(930000003,23,220,229,2000),(930000003,24,230,239,2000),(930000003,25,240,249,2000),
(930000003,26,250,259,2000),(930000003,27,260,269,2000),(930000003,28,270,279,2000),(930000003,29,280,289,2000),(930000003,30,290,299,2000),
(930000003,31,300,309,1500),(930000003,32,310,319,1500),(930000003,33,320,329,1500),(930000003,34,330,339,1500),(930000003,35,340,349,1500),
(930000003,36,350,359,1500),(930000003,37,360,369,1500),(930000003,38,370,379,1500),(930000003,39,380,389,1500),(930000003,40,390,399,1500),
(930000003,41,400,409,1200),(930000003,42,410,419,1200),(930000003,43,420,429,1200),(930000003,44,430,439,1200),(930000003,45,440,449,1200),
(930000003,46,450,459,1100),(930000003,47,460,469,1100),(930000003,48,470,479,1100),(930000003,49,480,489,1050),(930000003,50,490,499,1050),(930000003,51,500,500,1000);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_BADGE_CUBE','home_badge_cube','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/홈뱃지큐브','HOME_BADGE_CUBE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
