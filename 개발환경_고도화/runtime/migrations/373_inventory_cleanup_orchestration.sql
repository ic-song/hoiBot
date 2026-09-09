START TRANSACTION;

CREATE TABLE guild_medal_auto_purchase_runs (
  operation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_shop_item_id BIGINT UNSIGNED NULL,
  record_date DATE NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  base_price DECIMAL(30,0) NOT NULL,
  tax DECIMAL(30,0) NOT NULL,
  total_price DECIMAL(30,0) NOT NULL,
  point_before DECIMAL(30,0) NOT NULL,
  point_after DECIMAL(30,0) NOT NULL,
  purchase_count_before BIGINT UNSIGNED NOT NULL,
  purchase_count_after BIGINT UNSIGNED NOT NULL,
  item_before BIGINT UNSIGNED NOT NULL,
  item_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_guild_medal_auto_purchase_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_medal_auto_purchase_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_medal_auto_purchase_item FOREIGN KEY(guild_shop_item_id) REFERENCES guild_shop_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quest_reward_claim_runs (
  operation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  claimed_scope_json JSON NOT NULL,
  point_bonus DECIMAL(30,0) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_quest_reward_claim_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_quest_reward_claim_player FOREIGN KEY(player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_cleanup_orchestration_runs (
  operation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  source_contract VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  child_result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_inventory_cleanup_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_inventory_cleanup_player FOREIGN KEY(player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('QUEST_REWARD_CLAIM','quest_reward_claim','VERIFIED_USER','SHADOW',TRUE,1),
  ('INVENTORY_CLEANUP_ORCHESTRATION','inventory_cleanup_orchestration','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/퀘스트완료','QUEST_REWARD_CLAIM',TRUE),('ㅎㅎㅎ','QUEST_REWARD_CLAIM',TRUE),('/ㅇ','QUEST_REWARD_CLAIM',TRUE),('/ㅇㅇㅇ','QUEST_REWARD_CLAIM',TRUE),
  ('/정리','INVENTORY_CLEANUP_ORCHESTRATION',TRUE),('ㅇㅇㅇ','INVENTORY_CLEANUP_ORCHESTRATION',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
