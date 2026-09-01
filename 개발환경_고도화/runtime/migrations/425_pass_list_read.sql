INSERT INTO command_registry (command_code, handler_key, auth_scope, rollout_state, enabled, version)
VALUES ('PASS_LIST_READ', 'pass_list_read', 'VERIFIED_USER', 'LEGACY_ONLY', 1, 1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text, command_code, active)
VALUES ('/패스목록', 'PASS_LIST_READ', 1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
