START TRANSACTION;

CREATE TABLE IF NOT EXISTS pet_skill_compatibility_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_skill_compatibility_group_code (code),
  UNIQUE KEY uq_pet_skill_compatibility_group_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_skill_compatibility_members (
  group_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (group_id, skill_id),
  UNIQUE KEY uq_pet_skill_compatibility_member_order (group_id, display_order),
  UNIQUE KEY uq_pet_skill_compatibility_skill (skill_id),
  CONSTRAINT fk_pet_skill_compatibility_member_group FOREIGN KEY (group_id) REFERENCES pet_skill_compatibility_groups (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_compatibility_member_skill FOREIGN KEY (skill_id) REFERENCES skill_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES
  ('pet_skill_ten_won','십원',JSON_OBJECT('compatibilitySeed',TRUE),TRUE),
  ('pet_skill_salvation','구원',JSON_OBJECT('compatibilitySeed',TRUE),TRUE),
  ('pet_skill_hunter','헌터',JSON_OBJECT('compatibilitySeed',TRUE),TRUE),
  ('pet_skill_max_level_hunter','만렙헌터',JSON_OBJECT('compatibilitySeed',TRUE),TRUE),
  ('pet_skill_building_owner','건물주',JSON_OBJECT('compatibilitySeed',TRUE),TRUE),
  ('pet_skill_god_building_owner','하느님 위에 갓물주',JSON_OBJECT('compatibilitySeed',TRUE),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;

INSERT INTO pet_skill_compatibility_groups(code,display_order,active) VALUES
  ('ten_won_salvation',1,TRUE),('hunter_max_level_hunter',2,TRUE),('building_owner_god',3,TRUE)
ON DUPLICATE KEY UPDATE display_order=VALUES(display_order),active=TRUE;

INSERT INTO pet_skill_compatibility_members(group_id,skill_id,display_order)
SELECT compatibility_group.id,definition.id,seed_row.member_order
FROM (
  SELECT 'ten_won_salvation' group_code,'pet_skill_ten_won' skill_code,1 member_order UNION ALL
  SELECT 'ten_won_salvation','pet_skill_salvation',2 UNION ALL
  SELECT 'hunter_max_level_hunter','pet_skill_hunter',1 UNION ALL
  SELECT 'hunter_max_level_hunter','pet_skill_max_level_hunter',2 UNION ALL
  SELECT 'building_owner_god','pet_skill_building_owner',1 UNION ALL
  SELECT 'building_owner_god','pet_skill_god_building_owner',2
) seed_row
JOIN pet_skill_compatibility_groups compatibility_group ON compatibility_group.code=seed_row.group_code
JOIN skill_definitions definition ON definition.code=seed_row.skill_code
ON DUPLICATE KEY UPDATE display_order=VALUES(display_order);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_DUPLICATE_READ','pet_skill_duplicate_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫스킬중복','PET_SKILL_DUPLICATE_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
