-- Fail closed once a routed event can depend on the SHADOW metadata/handler.
SELECT (
  SELECT rollback_preflight_guard FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2 WHERE EXISTS (SELECT 1 FROM command_routing_decisions WHERE command_code='PET_SKILL_INFO')
  ) AS rollback_preflight
) AS rollback_preflight_guard;

START TRANSACTION;

UPDATE command_aliases SET command_code='PET_SKILL_READ',active=TRUE
WHERE command_text IN ('/펫스킬정보','/펫스킬정보 [조회값]') AND command_code='PET_SKILL_INFO';

UPDATE command_registry SET rollout_state='LEGACY_ONLY',enabled=FALSE,version=version+1
WHERE command_code='PET_SKILL_INFO';

DELETE FROM command_registry WHERE command_code='PET_SKILL_INFO'
  AND NOT EXISTS (SELECT 1 FROM command_routing_decisions WHERE command_code='PET_SKILL_INFO');

ALTER TABLE canonical_pet_skill_definitions
  DROP CONSTRAINT chk_canonical_pet_skill_info_tier_charm,
  DROP COLUMN castle_charm_bonus,
  DROP COLUMN raid_charm_bonus;

COMMIT;
