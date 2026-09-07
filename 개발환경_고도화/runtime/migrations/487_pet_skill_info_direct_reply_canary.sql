ALTER TABLE command_routing_decisions
  MODIFY COLUMN event_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

START TRANSACTION;

UPDATE command_registry
SET rollout_state='CANARY',version=version+1
WHERE command_code='PET_SKILL_INFO'
  AND handler_key='pet_skill_info'
  AND auth_scope='VERIFIED_USER'
  AND enabled=TRUE
  AND version=1
  AND rollout_state='SHADOW';

COMMIT;
