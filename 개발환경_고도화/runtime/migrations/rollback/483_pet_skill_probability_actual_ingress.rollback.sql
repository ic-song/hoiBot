START TRANSACTION;

UPDATE command_aliases
SET command_code='PET_SKILL_READ',active=TRUE
WHERE command_text='/펫스킬확률' AND command_code='PET_SKILL_PROBABILITY';

UPDATE command_registry
SET rollout_state='LEGACY_ONLY',enabled=FALSE,version=version+1
WHERE command_code='PET_SKILL_PROBABILITY';

DELETE FROM command_registry
WHERE command_code='PET_SKILL_PROBABILITY'
  AND NOT EXISTS (
    SELECT 1 FROM command_routing_decisions
    WHERE command_code='PET_SKILL_PROBABILITY'
  );

COMMIT;
