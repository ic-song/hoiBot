INSERT INTO command_registry (
    command_code,
    handler_key,
    auth_scope,
    rollout_state,
    enabled,
    version
) VALUES (
    'ADMIN_POINT_EDIT',
    'ADMIN_POINT_EDIT',
    'VERIFIED_USER',
    'SHADOW',
    1,
    1
)
ON DUPLICATE KEY UPDATE
    handler_key = VALUES(handler_key),
    auth_scope = VALUES(auth_scope),
    enabled = VALUES(enabled),
    version = version + 1;
