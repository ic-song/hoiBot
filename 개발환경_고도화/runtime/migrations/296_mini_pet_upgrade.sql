START TRANSACTION;

CREATE TABLE mini_pet_upgrade_grade_policies (
  grade_display_name VARCHAR(64) NOT NULL,
  base_rate DECIMAL(12,9) NOT NULL,
  max_level BIGINT UNSIGNED NOT NULL DEFAULT 300,
  success_charm_delta BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (grade_display_name),
  CONSTRAINT chk_mini_pet_upgrade_grade_rate CHECK (base_rate >= 0 AND base_rate <= 1),
  CONSTRAINT chk_mini_pet_upgrade_grade_max CHECK (max_level > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_upgrade_grade_policies(grade_display_name,base_rate,max_level,success_charm_delta) VALUES
  ('일반',0.870915,300,10000),('고급',0.080000,300,10000),('희귀',0.030000,300,10000),
  ('영웅',0.010000,300,10000),('전설',0.005000,300,10000),('전설+',0.002000,300,10000),
  ('신화',0.001000,300,10000),('신화+',0.000500,300,10000),('초월',0.000300,300,10000),
  ('초월+',0.000200,300,10000),('태초',0.000050,300,10000),('태초+',0.000020,300,10000),
  ('창세',0.000010,300,10000),('창조',0.000005,300,10000),('엘리트',0.000005,300,12000),
  ('마스터',0.000005,300,15000)
ON DUPLICATE KEY UPDATE base_rate=VALUES(base_rate),max_level=VALUES(max_level),success_charm_delta=VALUES(success_charm_delta),active=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3);

CREATE TABLE mini_pet_upgrade_point_policies (
  policy_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  min_target_level BIGINT UNSIGNED NOT NULL,
  max_target_level BIGINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (policy_code),
  UNIQUE KEY uq_mini_pet_upgrade_point_min (min_target_level),
  CONSTRAINT chk_mini_pet_upgrade_point_range CHECK (max_target_level >= min_target_level),
  CONSTRAINT chk_mini_pet_upgrade_point_cost CHECK (point_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_upgrade_point_policies(policy_code,min_target_level,max_target_level,point_cost) VALUES
  ('MINI-PET-UPGRADE-001-100',1,100,10000000),
  ('MINI-PET-UPGRADE-101-200',101,200,20000000),
  ('MINI-PET-UPGRADE-201-300',201,300,30000000)
ON DUPLICATE KEY UPDATE max_target_level=VALUES(max_target_level),point_cost=VALUES(point_cost),active=TRUE;

CREATE TABLE mini_pet_upgrade_attempts (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  level_before BIGINT UNSIGNED NOT NULL,
  level_after BIGINT UNSIGNED NOT NULL,
  battle_experience_before BIGINT UNSIGNED NOT NULL,
  battle_experience_after BIGINT UNSIGNED NOT NULL,
  castle_experience_before BIGINT UNSIGNED NOT NULL,
  castle_experience_after BIGINT UNSIGNED NOT NULL,
  raid_experience_before BIGINT UNSIGNED NOT NULL,
  raid_experience_after BIGINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  stone_required BIGINT UNSIGNED NOT NULL,
  boost_item_id BIGINT UNSIGNED NULL,
  base_rate DECIMAL(12,9) NOT NULL,
  skill_bonus_rate DECIMAL(12,9) NOT NULL,
  boost_rate DECIMAL(12,9) NOT NULL,
  effective_rate DECIMAL(12,9) NOT NULL,
  success_roll DECIMAL(20,17) NOT NULL,
  success BOOLEAN NOT NULL,
  mini_pet_version_before BIGINT UNSIGNED NOT NULL,
  mini_pet_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,sequence_no),
  KEY idx_mini_pet_upgrade_attempt_pet (owned_mini_pet_id,created_at),
  CONSTRAINT fk_mini_pet_upgrade_attempt_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_upgrade_attempt_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_upgrade_attempt_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_upgrade_attempt_boost FOREIGN KEY (boost_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE item_definitions
SET metadata_json=JSON_SET(COALESCE(metadata_json,JSON_OBJECT()),'$.consumer','MINI_PET_UPGRADE','$.objectKey','mini_pet_enhance_stone'),
    stackable=TRUE,active=TRUE,version=version+1
WHERE code IN ('mini_pet_enhance_stone','ITEM-RWD-018','ITEM-RWD-046');

UPDATE item_definitions
SET metadata_json=JSON_SET(COALESCE(metadata_json,JSON_OBJECT()),'$.consumer','MINI_PET_UPGRADE'),
    stackable=TRUE,active=TRUE,version=version+1
WHERE display_name LIKE '미니펫강화확률UP🐷(%';

INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES
  ('SKILL-MINI-PET-DOG-MASTER','개통령',JSON_OBJECT('miniPetSuccessBonusPct',5),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),rules_json=VALUES(rules_json),active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_UPGRADE','mini_pet_upgrade','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫강화','MINI_PET_UPGRADE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
