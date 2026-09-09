ALTER TABLE player_legacy_ring_reward_snapshots
  ADD COLUMN IF NOT EXISTS legacy_ring_present BOOLEAN NOT NULL DEFAULT TRUE AFTER castle_charm,
  ADD COLUMN IF NOT EXISTS calculation_error BOOLEAN NOT NULL DEFAULT FALSE AFTER legacy_ring_present;

UPDATE player_legacy_ring_reward_snapshots
SET legacy_ring_present=FALSE
WHERE claim_status='claimed' AND claimed_operation_id IS NOT NULL;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('RING_REWARD_STATS','ring_reward_stats','VERIFIED_USER','SHADOW',1,1),
  ('RING_RANK_RETIRED','ring_rank_retired','VERIFIED_USER','SHADOW',1,1),
  ('RING_INFO_RETIRED','ring_info_retired','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/반지보상통계','RING_REWARD_STATS',1),
  ('/반지순위','RING_RANK_RETIRED',1),
  ('/반지정보','RING_INFO_RETIRED',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
