START TRANSACTION;

CREATE TABLE IF NOT EXISTS mini_pet_battle_states (
  player_id BIGINT UNSIGNED NOT NULL,
  win_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  loss_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_mini_pet_battle_state_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mini_pet_battle_reward_definitions (
  reward_order INT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (reward_order),
  UNIQUE KEY uq_mini_pet_battle_reward_item (item_id),
  CONSTRAINT fk_mini_pet_battle_reward_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mini_pet_battle_settlements (
  operation_id BIGINT UNSIGNED NOT NULL,
  attacker_player_id BIGINT UNSIGNED NOT NULL,
  defender_player_id BIGINT UNSIGNED NOT NULL,
  attacker_won BOOLEAN NOT NULL,
  attacker_charm BIGINT UNSIGNED NOT NULL,
  defender_charm BIGINT UNSIGNED NOT NULL,
  attacker_final_charm BIGINT UNSIGNED NOT NULL,
  defender_final_charm BIGINT UNSIGNED NOT NULL,
  experience_delta INT UNSIGNED NOT NULL,
  point_delta BIGINT NOT NULL,
  robber_delta BIGINT NOT NULL,
  reset_ticket_delta INT NOT NULL,
  reward_item_id BIGINT UNSIGNED NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_mini_pet_battle_settlement_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_battle_settlement_attacker FOREIGN KEY (attacker_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_battle_settlement_defender FOREIGN KEY (defender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_battle_settlement_reward FOREIGN KEY (reward_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
  ('ITEM-RWD-026','펫 강화석⭐','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/미니펫대전'),TRUE,1),
  ('pet_food_special','펫먹이특식🥡(/특식오픈)','STACK',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/미니펫대전'),TRUE,1),
  ('junk','잡템☠️','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/미니펫대전'),TRUE,1),
  ('mini_pet_enhance_stone','미니펫 강화석💫','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/미니펫대전'),TRUE,1),
  ('trial_tower_booster','시탑 부스터🔮','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/미니펫대전'),TRUE,1),
  ('legacy-seasoned-chicken','양념치킨🐔','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','sourceCommand','/미니펫대전'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO mini_pet_battle_reward_definitions(reward_order,item_id,quantity,active)
SELECT seed.reward_order,item.id,1,TRUE
FROM (
  SELECT 1 reward_order,'ITEM-RWD-026' code UNION ALL SELECT 2,'pet_food_special' UNION ALL
  SELECT 3,'junk' UNION ALL SELECT 4,'mini_pet_enhance_stone' UNION ALL
  SELECT 5,'trial_tower_booster' UNION ALL SELECT 6,'legacy-seasoned-chicken'
) seed JOIN item_definitions item ON item.code=seed.code
ON DUPLICATE KEY UPDATE item_id=VALUES(item_id),quantity=1,active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MINI_PET_BATTLE_EXECUTE','mini_pet_battle_execute','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/미니펫대전','MINI_PET_BATTLE_EXECUTE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
