START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-HOI-WALLET','호이지갑👛(/지갑털기)','STACK',TRUE,JSON_OBJECT('legacyKey','호이지갑👛(/지갑털기)','sourceContract','v2.400'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

CREATE TABLE inventory_wallet_rng_config_versions (
  id BIGINT UNSIGNED NOT NULL,
  source_contract VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  empty_weight BIGINT UNSIGNED NOT NULL,
  total_weight BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_wallet_rng_config_hash (content_hash),
  CONSTRAINT chk_inventory_wallet_rng_config_weights CHECK (empty_weight < total_weight AND total_weight = 100000000),
  CONSTRAINT chk_inventory_wallet_rng_config_status CHECK (status IN ('draft','shadow','active','retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_wallet_rng_payout_tiers (
  config_version_id BIGINT UNSIGNED NOT NULL,
  tier_ordinal TINYINT UNSIGNED NOT NULL,
  weight_value BIGINT UNSIGNED NOT NULL,
  payout_amount BIGINT UNSIGNED NOT NULL,
  result_text VARCHAR(255) NOT NULL,
  PRIMARY KEY (config_version_id,tier_ordinal),
  CONSTRAINT fk_inventory_wallet_rng_tier_config FOREIGN KEY (config_version_id) REFERENCES inventory_wallet_rng_config_versions(id),
  CONSTRAINT chk_inventory_wallet_rng_tier_values CHECK (tier_ordinal BETWEEN 1 AND 6 AND weight_value > 0 AND payout_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_wallet_rng_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  config_version_id BIGINT UNSIGNED NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  used_count BIGINT UNSIGNED NOT NULL,
  empty_count BIGINT UNSIGNED NOT NULL,
  payout_count BIGINT UNSIGNED NOT NULL,
  total_payout BIGINT UNSIGNED NOT NULL,
  inventory_before BIGINT UNSIGNED NOT NULL,
  inventory_after BIGINT UNSIGNED NOT NULL,
  point_before DECIMAL(30,3) NOT NULL,
  point_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_inventory_wallet_rng_player (player_id,created_at),
  CONSTRAINT fk_inventory_wallet_rng_execution_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_inventory_wallet_rng_execution_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_inventory_wallet_rng_execution_config FOREIGN KEY (config_version_id) REFERENCES inventory_wallet_rng_config_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_wallet_rng_rolls (
  operation_id BIGINT UNSIGNED NOT NULL,
  roll_ordinal BIGINT UNSIGNED NOT NULL,
  first_sample DECIMAL(20,19) NOT NULL,
  second_sample DECIMAL(20,19) NULL,
  payout_tier_ordinal TINYINT UNSIGNED NULL,
  payout_amount BIGINT UNSIGNED NOT NULL,
  result_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,roll_ordinal),
  CONSTRAINT fk_inventory_wallet_rng_roll_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_inventory_wallet_rng_roll_result CHECK (result_code IN ('empty','payout'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO inventory_wallet_rng_config_versions(id,source_contract,content_hash,empty_weight,total_weight,status,effective_at)
VALUES (940000001,'v2.400',SHA2('v2.400|HOI_WALLET|empty:70000000|payout:82000000:10000000,14000000:30000000,3500000:50000000,400000:100000000,90000:300000000,10000:1000000000',256),70000000,100000000,'shadow','2026-08-30 00:00:00.000');

INSERT INTO inventory_wallet_rng_payout_tiers(config_version_id,tier_ordinal,weight_value,payout_amount,result_text) VALUES
(940000001,1,82000000,10000000,'호이🤪의 지갑을 슬쩍 했다👍🏻'),
(940000001,2,14000000,30000000,'호이🤪를 후리고 털었다!🏏'),
(940000001,3,3500000,50000000,'호이🤪의 바지를 벗기고 털었다🤏🏻'),
(940000001,4,400000,100000000,'호이🤪의 머리를 밀고 털었다🧑‍🦲'),
(940000001,5,90000,300000000,'호이🤪의 강냉이를 후리고 털었다🦷'),
(940000001,6,10000,1000000000,'호이🤪의 방장을 훔치고 털었다🌟');

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('INVENTORY_WALLET_RNG_OPEN','inventory_wallet_rng_open','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/지갑털기','INVENTORY_WALLET_RNG_OPEN',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
