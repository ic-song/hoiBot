CREATE TABLE IF NOT EXISTS mini_pet_elite_combine_recipes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipe_code VARCHAR(64) NOT NULL,
  recipe_version INT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  success_rate DECIMAL(18,17) NOT NULL,
  material_grade_name VARCHAR(32) NOT NULL,
  material_min_enhancement BIGINT UNSIGNED NOT NULL,
  excluded_material_name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_elite_combine_recipe_code_version (recipe_code,recipe_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_elite_combine_recipes
(recipe_code,recipe_version,point_cost,success_rate,material_grade_name,material_min_enhancement,excluded_material_name,active)
VALUES ('ELITE-COMBINE',1,35000000000,0.10000000000000000,'창조',300,'컬렉션창조 미니펫',TRUE)
ON DUPLICATE KEY UPDATE point_cost=VALUES(point_cost),success_rate=VALUES(success_rate),material_grade_name=VALUES(material_grade_name),material_min_enhancement=VALUES(material_min_enhancement),excluded_material_name=VALUES(excluded_material_name),active=VALUES(active);

INSERT INTO mini_pet_definitions(code,display_name,grade_code,grade_display_name,emoji_value,active) VALUES
('elite-combine-01','아프간 하운드','elite','엘리트','𓂀',TRUE),
('elite-combine-02','래브라도 리트리버','elite','엘리트','𓆃',TRUE),
('elite-combine-03','저먼 셰퍼드','elite','엘리트','☪︎',TRUE),
('elite-combine-04','캐벌리어 킹 찰스 스패니얼','elite','엘리트','⌖',TRUE),
('elite-combine-05','시베리안 허스키','elite','엘리트','🌴',TRUE),
('elite-combine-06','티베탄 마스티프','elite','엘리트','🐅',TRUE),
('elite-combine-07','알래스칸 말라뮤트','elite','엘리트','𓃣',TRUE),
('elite-combine-08','코커 스패니얼','elite','엘리트','𓊝',TRUE),
('elite-combine-09','웰시 코기','elite','엘리트','⚜',TRUE),
('elite-combine-10','보더 콜리','elite','엘리트','🐾',TRUE),
('elite-combine-11','셔틀랜드 쉽독','elite','엘리트','✿',TRUE),
('elite-combine-12','스탠다드 푸들','elite','엘리트','🐾',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),grade_code=VALUES(grade_code),grade_display_name=VALUES(grade_display_name),emoji_value=VALUES(emoji_value),active=VALUES(active);

CREATE TABLE IF NOT EXISTS mini_pet_elite_combine_rewards (
  recipe_id BIGINT UNSIGNED NOT NULL,
  pool_sequence INT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  sale_price DECIMAL(30,3) NOT NULL,
  battle_experience BIGINT UNSIGNED NOT NULL,
  castle_experience BIGINT UNSIGNED NOT NULL,
  raid_experience BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (recipe_id,pool_sequence),
  UNIQUE KEY uq_mini_pet_elite_reward_definition (recipe_id,mini_pet_definition_id),
  CONSTRAINT fk_mini_pet_elite_reward_recipe FOREIGN KEY (recipe_id) REFERENCES mini_pet_elite_combine_recipes(id),
  CONSTRAINT fk_mini_pet_elite_reward_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_elite_combine_rewards
(recipe_id,pool_sequence,mini_pet_definition_id,sale_price,battle_experience,castle_experience,raid_experience,active)
SELECT recipe.id,reward.pool_sequence,definition.id,10000000000,reward.experience,reward.experience,reward.experience,TRUE
FROM mini_pet_elite_combine_recipes recipe
JOIN (
  SELECT 1 pool_sequence,'elite-combine-01' code,63500 experience UNION ALL
  SELECT 2,'elite-combine-02',64000 UNION ALL SELECT 3,'elite-combine-03',65000 UNION ALL
  SELECT 4,'elite-combine-04',65000 UNION ALL SELECT 5,'elite-combine-05',65000 UNION ALL
  SELECT 6,'elite-combine-06',64500 UNION ALL SELECT 7,'elite-combine-07',64500 UNION ALL
  SELECT 8,'elite-combine-08',64500 UNION ALL SELECT 9,'elite-combine-09',64500 UNION ALL
  SELECT 10,'elite-combine-10',63500 UNION ALL SELECT 11,'elite-combine-11',65500 UNION ALL
  SELECT 12,'elite-combine-12',65000
) reward
JOIN mini_pet_definitions definition ON definition.code=reward.code
WHERE recipe.recipe_code='ELITE-COMBINE' AND recipe.recipe_version=1
ON DUPLICATE KEY UPDATE mini_pet_definition_id=VALUES(mini_pet_definition_id),sale_price=VALUES(sale_price),battle_experience=VALUES(battle_experience),castle_experience=VALUES(castle_experience),raid_experience=VALUES(raid_experience),active=VALUES(active);

CREATE TABLE IF NOT EXISTS mini_pet_elite_combine_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  recipe_id BIGINT UNSIGNED NOT NULL,
  recipe_version INT UNSIGNED NOT NULL,
  first_owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  second_owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  first_definition_id BIGINT UNSIGNED NOT NULL,
  second_definition_id BIGINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  point_balance_before DECIMAL(30,3) NOT NULL,
  point_balance_after DECIMAL(30,3) NOT NULL,
  success_roll DECIMAL(18,17) NOT NULL,
  success BOOLEAN NOT NULL,
  reward_roll DECIMAL(18,17) NULL,
  reward_pool_sequence INT UNSIGNED NULL,
  reward_definition_id BIGINT UNSIGNED NULL,
  created_owned_mini_pet_id BIGINT UNSIGNED NULL,
  material_snapshot_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_elite_combine_operation (operation_id),
  CONSTRAINT fk_mini_pet_elite_combine_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_mini_pet_elite_combine_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_mini_pet_elite_combine_recipe FOREIGN KEY (recipe_id) REFERENCES mini_pet_elite_combine_recipes(id),
  CONSTRAINT fk_mini_pet_elite_combine_reward_definition FOREIGN KEY (reward_definition_id) REFERENCES mini_pet_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MINI_PET_ELITE_COMBINE','mini_pet_elite_combine','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/미니펫조합엘리트','MINI_PET_ELITE_COMBINE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
