START TRANSACTION;

UPDATE command_registry
SET rollout_state='SHADOW', enabled=TRUE, version=version+1
WHERE command_code='ADMIN_STATUS_ALL';

COMMIT;
