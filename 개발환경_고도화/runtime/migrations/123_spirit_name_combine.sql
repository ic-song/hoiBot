START TRANSACTION;

UPDATE item_definitions
SET active = TRUE
WHERE code = 'ITEM-RWD-SEASONED-CHICKEN';

INSERT INTO command_registry(command_code, handler_key, auth_scope, rollout_state, enabled, version)
VALUES ('SPIRIT_NAME_COMBINE', 'spirit_name_combine', 'VERIFIED_USER', 'SHADOW', TRUE, 1)
ON DUPLICATE KEY UPDATE
  handler_key = VALUES(handler_key), auth_scope = VALUES(auth_scope), enabled = TRUE, version = VALUES(version);

INSERT INTO command_aliases(command_text, command_code, active)
VALUES ('/정령이름조합', 'SPIRIT_NAME_COMBINE', TRUE)
ON DUPLICATE KEY UPDATE command_code = VALUES(command_code), active = TRUE;

COMMIT;
