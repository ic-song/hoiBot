START TRANSACTION;

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MINIPET_EXP_RANK_READ','minipet_exp_rank_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE
  handler_key=VALUES(handler_key),
  auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),
  enabled=VALUES(enabled),
  version=version+1;

INSERT INTO command_aliases (command_text,command_code,active)
VALUES ('/미니펫종합순위','MINIPET_EXP_RANK_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

INSERT INTO leaderboards (code,season_key,calculated_at)
VALUES ('minipet_exp_total','lifetime',UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE calculated_at=calculated_at;

COMMIT;
