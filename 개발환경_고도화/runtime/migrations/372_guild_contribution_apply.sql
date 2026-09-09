CREATE TABLE IF NOT EXISTS guild_progression_states (
  guild_id BIGINT UNSIGNED NOT NULL,
  level SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  max_members SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id),
  CONSTRAINT fk_guild_progression_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT chk_guild_progression_level CHECK (level BETWEEN 1 AND 21),
  CONSTRAINT chk_guild_progression_members CHECK (max_members>=5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_member_contribution_states (
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  contribution_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id,player_id),
  CONSTRAINT fk_guild_member_contribution_member FOREIGN KEY (guild_id,player_id) REFERENCES guild_members(guild_id,player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_contribution_level_policies (
  target_level SMALLINT UNSIGNED NOT NULL,
  required_experience BIGINT UNSIGNED NOT NULL,
  max_member_increment SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  guild_fund_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pet_skill_book_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pet_enhance_stone_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  all_member_pet_food_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  source_contract VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (target_level),
  UNIQUE KEY uq_guild_contribution_required_exp (required_experience),
  CONSTRAINT chk_guild_contribution_target_level CHECK (target_level BETWEEN 2 AND 21)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_contribution_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  medal_item_id BIGINT UNSIGNED NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  medal_before BIGINT UNSIGNED NOT NULL,
  medal_after BIGINT UNSIGNED NOT NULL,
  member_contribution_after BIGINT UNSIGNED NOT NULL,
  guild_experience_after BIGINT UNSIGNED NOT NULL,
  guild_level_before SMALLINT UNSIGNED NOT NULL,
  guild_level_after SMALLINT UNSIGNED NOT NULL,
  heart_bonus BOOLEAN NOT NULL,
  reached_levels_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_guild_contribution_event (event_key),
  CONSTRAINT fk_guild_contribution_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_contribution_run_member FOREIGN KEY (guild_id,player_id) REFERENCES guild_members(guild_id,player_id),
  CONSTRAINT fk_guild_contribution_run_item FOREIGN KEY (medal_item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_contribution_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  contribution_delta BIGINT UNSIGNED NOT NULL,
  member_contribution_after BIGINT UNSIGNED NOT NULL,
  guild_experience_after BIGINT UNSIGNED NOT NULL,
  guild_level_after SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_guild_contribution_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_contribution_ledger_member FOREIGN KEY (guild_id,player_id) REFERENCES guild_members(guild_id,player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_contribution_random_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  draw_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  roll_value DECIMAL(11,10) NOT NULL,
  threshold_value DECIMAL(11,10) NOT NULL,
  triggered BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,draw_code),
  CONSTRAINT fk_guild_contribution_random_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_guild_contribution_roll CHECK (roll_value>=0 AND roll_value<1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_contribution_level_reward_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  target_level SMALLINT UNSIGNED NOT NULL,
  guild_fund_reward BIGINT UNSIGNED NOT NULL,
  pet_skill_book_reward BIGINT UNSIGNED NOT NULL,
  pet_enhance_stone_reward BIGINT UNSIGNED NOT NULL,
  all_member_pet_food_reward BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,target_level),
  CONSTRAINT fk_guild_contribution_level_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_contribution_level_run_policy FOREIGN KEY (target_level) REFERENCES guild_contribution_level_policies(target_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO currency_definitions(code,display_name,scale_digits,active) VALUES('guild_fund','길드자금',0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),scale_digits=0,active=TRUE;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('guild_contribution_medal','길드공헌훈장🌟(/길드공헌 숫자)','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','consumerCommand','/길드공헌'),TRUE,1),
('pet_food','펫먹이🍼','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','producerCommand','/길드공헌'),TRUE,1),
('mini_pet_draw','미니펫뽑기🐹(/미니펫오픈)','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','producerCommand','/길드공헌'),TRUE,1),
('furniture_draw','가구뽑기🪑(/가구뽑기)','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','producerCommand','/길드공헌'),TRUE,1),
('pet_skill_book_fragment','펫스킬북 조각📙','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','legacyField','guild.warehouse.petSkillBook'),TRUE,1),
('pet_enhance_stone','펫 강화석','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','legacyField','guild.warehouse.pet'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO guild_contribution_level_policies(target_level,required_experience,max_member_increment,guild_fund_reward,pet_skill_book_reward,pet_enhance_stone_reward,all_member_pet_food_reward,source_contract) VALUES
(2,1000,1,0,0,0,0,'v2.400'),(3,2000,1,0,0,0,0,'v2.400'),(4,4000,1,0,0,0,0,'v2.400'),(5,8000,1,0,0,0,0,'v2.400'),
(6,12000,1,0,0,0,0,'v2.400'),(7,16000,1,0,0,0,0,'v2.400'),(8,20000,1,0,0,0,0,'v2.400'),(9,24000,1,0,0,0,0,'v2.400'),(10,28000,1,0,0,0,0,'v2.400'),
(11,40000,0,0,0,0,100000,'v2.400'),(12,50000,0,300000000000,0,0,0,'v2.400'),(13,60000,0,0,30000,0,0,'v2.400'),(14,70000,0,0,35000,0,0,'v2.400'),
(15,80000,0,500000000000,0,0,0,'v2.400'),(16,90000,0,0,0,100000,0,'v2.400'),(17,100000,0,0,0,0,300000,'v2.400'),(18,120000,0,700000000000,0,0,0,'v2.400'),
(19,150000,0,0,60000,0,0,'v2.400'),(20,180000,0,0,70000,0,0,'v2.400'),(21,250000,0,900000000000,0,0,0,'v2.400')
ON DUPLICATE KEY UPDATE required_experience=VALUES(required_experience),max_member_increment=VALUES(max_member_increment),guild_fund_reward=VALUES(guild_fund_reward),pet_skill_book_reward=VALUES(pet_skill_book_reward),pet_enhance_stone_reward=VALUES(pet_enhance_stone_reward),all_member_pet_food_reward=VALUES(all_member_pet_food_reward),source_contract='v2.400';

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_CONTRIBUTION_APPLY','guild_contribution_apply','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/길드공헌 [숫자]','GUILD_CONTRIBUTION_APPLY',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
