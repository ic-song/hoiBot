INSERT INTO command_registry (
    command_code,
    handler_key,
    auth_scope,
    rollout_state,
    enabled,
    version
) VALUES
    ('PACKAGE_BAG', 'PACKAGE_BAG', 'VERIFIED_USER', 'CANARY', 1, 1),
    ('PACKAGE_USE', 'PACKAGE_USE', 'VERIFIED_USER', 'CANARY', 1, 1)
ON DUPLICATE KEY UPDATE
    handler_key = VALUES(handler_key),
    auth_scope = VALUES(auth_scope),
    rollout_state = VALUES(rollout_state),
    enabled = VALUES(enabled),
    version = version + 1;

INSERT INTO command_aliases (command_text, command_code, active) VALUES
    ('/패키지가방', 'PACKAGE_BAG', 1),
    ('/패키지사용', 'PACKAGE_USE', 1)
ON DUPLICATE KEY UPDATE
    command_code = VALUES(command_code),
    active = VALUES(active);
