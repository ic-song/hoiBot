START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-FORTUNE-POUCH','복주머니🧧','STACK',TRUE,JSON_OBJECT('legacyKey','복주머니🧧','sourceContract','v2.400'),TRUE,1),
('ITEM-FORTUNE-EXECUTION-SWORD','집행검👑','STACK',TRUE,JSON_OBJECT('legacyKey','집행검👑','sourceContract','v2.400'),TRUE,1),
('ITEM-FORTUNE-IMMORTAL','불멸🪬','STACK',TRUE,JSON_OBJECT('legacyKey','불멸🪬','sourceContract','v2.400'),TRUE,1),
('ITEM-RWD-PET-FOOD-BOX','펫먹이상자📦(/상자오픈)','STACK',TRUE,JSON_OBJECT('legacyKey','펫먹이상자📦(/상자오픈)','sourceContract','v2.400'),TRUE,1),
('ITEM-RWD-026','펫 강화석⭐','ITEM',TRUE,JSON_OBJECT('legacyKey','펫 강화석⭐','sourceContract','v2.400'),TRUE,1),
('ITEM-ELEMENTAL-UPGRADE-STONE','정령 강화석🥀','ITEM',TRUE,JSON_OBJECT('legacyKey','정령 강화석🥀','sourceContract','v2.400'),TRUE,1),
('ITEM-RWD-TRASH-BOX','잡템상자☠','STACK',TRUE,JSON_OBJECT('legacyKey','잡템상자☠','sourceContract','v2.400'),TRUE,1),
('ITEM-FORTUNE-ALLOWANCE','용돈💸','STACK',TRUE,JSON_OBJECT('legacyKey','용돈💸','sourceContract','v2.400'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)),active=TRUE,version=version+1;

CREATE TABLE inventory_fortune_pouch_config_versions (
  id BIGINT UNSIGNED NOT NULL,
  source_contract VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  consume_item_id BIGINT UNSIGNED NOT NULL,
  total_weight BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_fortune_pouch_config_hash (content_hash),
  CONSTRAINT fk_inventory_fortune_pouch_consume_item FOREIGN KEY (consume_item_id) REFERENCES item_definitions(id),
  CONSTRAINT chk_inventory_fortune_pouch_total_weight CHECK (total_weight=100000000),
  CONSTRAINT chk_inventory_fortune_pouch_status CHECK (status IN ('draft','shadow','active','retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_fortune_pouch_reward_tiers (
  config_version_id BIGINT UNSIGNED NOT NULL,
  tier_ordinal TINYINT UNSIGNED NOT NULL,
  weight_value BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (config_version_id,tier_ordinal),
  CONSTRAINT fk_inventory_fortune_pouch_tier_config FOREIGN KEY (config_version_id) REFERENCES inventory_fortune_pouch_config_versions(id),
  CONSTRAINT fk_inventory_fortune_pouch_tier_item FOREIGN KEY (item_id) REFERENCES item_definitions(id),
  CONSTRAINT chk_inventory_fortune_pouch_tier CHECK (tier_ordinal BETWEEN 1 AND 7 AND weight_value>0 AND reward_quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_fortune_pouch_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  config_version_id BIGINT UNSIGNED NOT NULL,
  requested_count BIGINT NOT NULL,
  inventory_before BIGINT UNSIGNED NOT NULL,
  inventory_after BIGINT UNSIGNED NOT NULL,
  roll_count BIGINT UNSIGNED NOT NULL,
  reward_summary_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_inventory_fortune_pouch_player (player_id,created_at),
  CONSTRAINT fk_inventory_fortune_pouch_execution_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_inventory_fortune_pouch_execution_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_inventory_fortune_pouch_execution_config FOREIGN KEY (config_version_id) REFERENCES inventory_fortune_pouch_config_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_fortune_pouch_rolls (
  operation_id BIGINT UNSIGNED NOT NULL,
  roll_ordinal BIGINT UNSIGNED NOT NULL,
  sample DECIMAL(20,19) NOT NULL,
  reward_tier_ordinal TINYINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,roll_ordinal),
  CONSTRAINT fk_inventory_fortune_pouch_roll_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_inventory_fortune_pouch_roll_item FOREIGN KEY (item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO inventory_fortune_pouch_config_versions(id,source_contract,content_hash,consume_item_id,total_weight,status,effective_at)
SELECT 940000002,'v2.400',SHA2('v2.400|FORTUNE_POUCH|23,100,30000,50000,80000,115000,724877|allowance:5',256),id,100000000,'shadow','2026-08-30 00:00:00.000'
FROM item_definitions WHERE code='ITEM-FORTUNE-POUCH';

INSERT INTO inventory_fortune_pouch_reward_tiers(config_version_id,tier_ordinal,weight_value,item_id,reward_quantity)
SELECT 940000002,seed.tier_ordinal,seed.weight_value,item.id,seed.reward_quantity
FROM (
  SELECT 1 tier_ordinal,2300 weight_value,'ITEM-FORTUNE-EXECUTION-SWORD' item_code,1 reward_quantity UNION ALL
  SELECT 2,10000,'ITEM-FORTUNE-IMMORTAL',1 UNION ALL
  SELECT 3,3000000,'ITEM-RWD-PET-FOOD-BOX',1 UNION ALL
  SELECT 4,5000000,'ITEM-RWD-026',1 UNION ALL
  SELECT 5,8000000,'ITEM-ELEMENTAL-UPGRADE-STONE',1 UNION ALL
  SELECT 6,11500000,'ITEM-RWD-TRASH-BOX',1 UNION ALL
  SELECT 7,72487700,'ITEM-FORTUNE-ALLOWANCE',5
) seed JOIN item_definitions item ON item.code=seed.item_code;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('INVENTORY_FORTUNE_POUCH_OPEN','inventory_fortune_pouch_open','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/복주머니','INVENTORY_FORTUNE_POUCH_OPEN',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
