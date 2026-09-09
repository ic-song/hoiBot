INSERT INTO command_registry(command_code, handler_key, auth_scope, rollout_state, enabled)
VALUES ('DIAMOND_SHOP_CATALOG_READ', 'DIAMOND_SHOP_CATALOG_READ', 'VERIFIED_USER', 'SHADOW', TRUE)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key), auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state), enabled=VALUES(enabled), version=version+1;

INSERT INTO command_aliases(command_text, command_code, active)
VALUES ('/다이아상점', 'DIAMOND_SHOP_CATALOG_READ', TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code), active=VALUES(active);
