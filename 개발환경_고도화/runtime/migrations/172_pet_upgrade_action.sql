START TRANSACTION;

CREATE TABLE pet_upgrade_level_policies (
  policy_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  min_level BIGINT UNSIGNED NOT NULL,
  max_level BIGINT UNSIGNED NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  base_rate DECIMAL(9,6) NOT NULL,
  decrement_rate DECIMAL(9,6) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (policy_code),
  UNIQUE KEY uq_pet_upgrade_policy_min_level (min_level),
  CONSTRAINT chk_pet_upgrade_policy_range CHECK (max_level IS NULL OR max_level >= min_level),
  CONSTRAINT chk_pet_upgrade_policy_rate CHECK (base_rate >= 0 AND base_rate <= 1 AND decrement_rate >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_upgrade_level_policies
  (policy_code,min_level,max_level,point_cost,base_rate,decrement_rate,active) VALUES
  ('PET-UPGRADE-000-099',0,99,20000000,0.55,0.005,1),
  ('PET-UPGRADE-100-199',100,199,50000000,0.05,0,1),
  ('PET-UPGRADE-200-PLUS',200,NULL,100000000,0.05,0,1)
ON DUPLICATE KEY UPDATE max_level=VALUES(max_level),point_cost=VALUES(point_cost),base_rate=VALUES(base_rate),decrement_rate=VALUES(decrement_rate),active=1;

CREATE TABLE pet_upgrade_attempts (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_pet_id BIGINT UNSIGNED NOT NULL,
  level_before BIGINT UNSIGNED NOT NULL,
  level_after BIGINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  stone_required BIGINT UNSIGNED NOT NULL,
  boost_item_id BIGINT UNSIGNED NULL,
  base_rate DECIMAL(9,6) NOT NULL,
  skill_bonus_rate DECIMAL(9,6) NOT NULL,
  boost_rate DECIMAL(9,6) NOT NULL,
  effective_rate DECIMAL(9,6) NOT NULL,
  success_roll DECIMAL(20,17) NOT NULL,
  success BOOLEAN NOT NULL,
  artisan_roll DECIMAL(20,17) NULL,
  stone_preserved BOOLEAN NOT NULL,
  pet_version_before BIGINT UNSIGNED NOT NULL,
  pet_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id,sequence_no),
  KEY idx_pet_upgrade_attempt_pet (player_pet_id,created_at),
  CONSTRAINT fk_pet_upgrade_attempt_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_upgrade_attempt_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_upgrade_attempt_boost FOREIGN KEY (boost_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE item_definitions
SET metadata_json=JSON_SET(COALESCE(metadata_json,JSON_OBJECT()),'$.objectKey','pet_enhance_stone','$.consumer','PET_UPGRADE_ACTION')
WHERE code IN ('pet_enhance_stone','ITEM-RWD-026');

UPDATE item_definitions
SET metadata_json=JSON_SET(COALESCE(metadata_json,JSON_OBJECT()),'$.consumer','PET_UPGRADE_ACTION')
WHERE display_name REGEXP '^펫강화확률UP🌟\\([0-9]+(\\.[0-9]+)?%\\)$';

INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES
  ('SKILL-PET-BALD-BLACKSMITH','대머리 대장장이',JSON_OBJECT('petSuccessBonusPct',5),1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),rules_json=VALUES(rules_json),active=1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_UPGRADE_ACTION','pet_upgrade_action','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫강화','PET_UPGRADE_ACTION',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
