INSERT INTO command_registry (
  command_code,
  handler_key,
  auth_scope,
  rollout_state,
  enabled,
  version
) VALUES (
  'MARKET_FREE_MARKET_READ',
  'free_market_read',
  'VERIFIED_USER',
  'SHADOW',
  1,
  1
)
ON DUPLICATE KEY UPDATE
  handler_key = VALUES(handler_key),
  auth_scope = VALUES(auth_scope),
  rollout_state = VALUES(rollout_state),
  enabled = VALUES(enabled),
  version = version + 1;

INSERT INTO command_aliases (command_text, command_code, active)
VALUES
  ('/자유시장', 'MARKET_FREE_MARKET_READ', 1),
  ('ㅈㅈ', 'MARKET_FREE_MARKET_READ', 1)
ON DUPLICATE KEY UPDATE
  command_code = VALUES(command_code),
  active = VALUES(active);
