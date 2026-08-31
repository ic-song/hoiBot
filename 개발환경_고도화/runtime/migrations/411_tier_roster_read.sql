START TRANSACTION;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('TIER_ROSTER_READ','tier_roster_read','VERIFIED_USER','SHADOW',1,1),
('TIER_RANK_READ','tier_rank_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/티어확인','TIER_ROSTER_READ',1),
('/티어순위','TIER_RANK_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
