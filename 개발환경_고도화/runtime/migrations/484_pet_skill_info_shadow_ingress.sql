START TRANSACTION;

ALTER TABLE canonical_pet_skill_definitions
  ADD COLUMN raid_charm_bonus BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER equip_description,
  ADD COLUMN castle_charm_bonus BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER raid_charm_bonus;

UPDATE canonical_pet_skill_definitions
SET raid_charm_bonus=0,castle_charm_bonus=0
WHERE active_flag=TRUE;

UPDATE canonical_pet_skill_definitions
SET raid_charm_bonus=CASE legacy_source_key
    WHEN 'skill_060' THEN 100000
    WHEN 'skill_061' THEN 150000
    WHEN 'skill_062' THEN 200000
    WHEN 'skill_063' THEN 300000
    WHEN 'skill_064' THEN 400000
    WHEN 'skill_065' THEN 500000
    WHEN 'skill_066' THEN 650000
    WHEN 'skill_067' THEN 800000
    WHEN 'skill_068' THEN 1000000
    WHEN 'skill_069' THEN 1250000
    WHEN 'skill_070' THEN 1500000
    WHEN 'skill_071' THEN 1800000
    WHEN 'skill_072' THEN 2200000
    WHEN 'skill_073' THEN 2600000
    WHEN 'skill_074' THEN 3000000
    WHEN 'skill_075' THEN 3500000
    WHEN 'skill_076' THEN 4000000
    WHEN 'skill_077' THEN 4600000
    WHEN 'skill_078' THEN 5200000
    WHEN 'skill_079' THEN 6000000
    WHEN 'skill_080' THEN 7000000
    WHEN 'skill_081' THEN 8000000
    WHEN 'skill_082' THEN 9000000
    WHEN 'skill_083' THEN 10000000
    WHEN 'skill_084' THEN 12000000
    WHEN 'skill_085' THEN 14000000
    WHEN 'skill_086' THEN 16000000
    WHEN 'skill_087' THEN 18000000
    WHEN 'skill_088' THEN 21000000
    WHEN 'skill_089' THEN 25000000
  END,
  castle_charm_bonus=CASE legacy_source_key
    WHEN 'skill_060' THEN 100000
    WHEN 'skill_061' THEN 150000
    WHEN 'skill_062' THEN 200000
    WHEN 'skill_063' THEN 300000
    WHEN 'skill_064' THEN 400000
    WHEN 'skill_065' THEN 500000
    WHEN 'skill_066' THEN 650000
    WHEN 'skill_067' THEN 800000
    WHEN 'skill_068' THEN 1000000
    WHEN 'skill_069' THEN 1250000
    WHEN 'skill_070' THEN 1500000
    WHEN 'skill_071' THEN 1800000
    WHEN 'skill_072' THEN 2200000
    WHEN 'skill_073' THEN 2600000
    WHEN 'skill_074' THEN 3000000
    WHEN 'skill_075' THEN 3500000
    WHEN 'skill_076' THEN 4000000
    WHEN 'skill_077' THEN 4600000
    WHEN 'skill_078' THEN 5200000
    WHEN 'skill_079' THEN 6000000
    WHEN 'skill_080' THEN 7000000
    WHEN 'skill_081' THEN 8000000
    WHEN 'skill_082' THEN 9000000
    WHEN 'skill_083' THEN 10000000
    WHEN 'skill_084' THEN 12000000
    WHEN 'skill_085' THEN 14000000
    WHEN 'skill_086' THEN 16000000
    WHEN 'skill_087' THEN 18000000
    WHEN 'skill_088' THEN 21000000
    WHEN 'skill_089' THEN 25000000
  END
WHERE legacy_source_key BETWEEN 'skill_060' AND 'skill_089'
  AND tier_exclusive_flag=TRUE;

ALTER TABLE canonical_pet_skill_definitions
  ADD CONSTRAINT chk_canonical_pet_skill_info_tier_charm CHECK (
    tier_exclusive_flag IS NULL OR tier_exclusive_flag=FALSE
    OR (raid_charm_bonus IS NOT NULL AND castle_charm_bonus IS NOT NULL)
  );

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_INFO','pet_skill_info','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/펫스킬정보','PET_SKILL_INFO',TRUE),
('/펫스킬정보 [조회값]','PET_SKILL_INFO',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
