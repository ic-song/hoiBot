CREATE TABLE IF NOT EXISTS auto_daily_quest_reward_definitions (
  reward_scope VARCHAR(32) NOT NULL,
  reward_order SMALLINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (reward_scope,reward_order),
  CONSTRAINT fk_auto_daily_reward_item FOREIGN KEY (item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auto_daily_quest_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  run_count_json JSON NOT NULL,
  claimed_scope_json JSON NOT NULL,
  stop_reason_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_auto_daily_player_date (player_id,record_date),
  CONSTRAINT fk_auto_daily_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_auto_daily_run_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
  ('auto_daily_quest_ticket','자동일퀘권📝','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/자동일퀘'),TRUE,1),
  ('ITEM-RWD-053','다이아상자💎(/다이아상자오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','daily_quest'),TRUE,1),
  ('point_box_100m','1억포인트상자🪙(/포인트상자오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','daily_quest'),TRUE,1),
  ('pet_enhance_stone','펫 강화석⭐','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','daily_quest'),TRUE,1),
  ('pet_skill_book','펫스킬북📙(/펫스킬오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','weekly_quest'),TRUE,1),
  ('mini_pet_draw','미니펫뽑기🐹(/미니펫오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','weekly_quest'),TRUE,1),
  ('land_document','땅문서📜','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','weekly_quest'),TRUE,1),
  ('ITEM-RWD-001','펫스윗홈인테리어샵🖼️(/샵오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','rewardFor','weekly_quest'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO auto_daily_quest_reward_definitions(reward_scope,reward_order,item_id,quantity,active)
SELECT seed.scope_code,seed.reward_order,item.id,seed.quantity,TRUE
FROM (
  SELECT 'DAILY' scope_code,1 reward_order,'ITEM-RWD-053' item_code,1 quantity UNION ALL
  SELECT 'DAILY',2,'point_box_100m',1 UNION ALL
  SELECT 'DAILY',3,'pet_enhance_stone',30 UNION ALL
  SELECT 'WEEKLY',1,'pet_skill_book',1 UNION ALL
  SELECT 'WEEKLY',2,'ITEM-RWD-053',2 UNION ALL
  SELECT 'WEEKLY',3,'mini_pet_draw',100 UNION ALL
  SELECT 'WEEKLY',4,'land_document',1 UNION ALL
  SELECT 'WEEKLY',5,'ITEM-RWD-001',100 UNION ALL
  SELECT 'PASS_DAILY',1,'point_box_100m',2 UNION ALL
  SELECT 'PREMIUM_DAILY',1,'ITEM-RWD-053',1
) seed JOIN item_definitions item ON item.code=seed.item_code
ON DUPLICATE KEY UPDATE item_id=VALUES(item_id),quantity=VALUES(quantity),active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('AUTO_DAILY_QUEST_ORCHESTRATION','auto_daily_quest_orchestration','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/자동일퀘','AUTO_DAILY_QUEST_ORCHESTRATION',TRUE),
  ('ㅇㅋㅋ','AUTO_DAILY_QUEST_ORCHESTRATION',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
