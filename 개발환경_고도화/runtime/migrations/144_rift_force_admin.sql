INSERT INTO guild_territory_wars(war_key,active,rift_event_history_json)
VALUES ('current',FALSE,JSON_ARRAY())
ON DUPLICATE KEY UPDATE war_key=VALUES(war_key);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('RIFT_FORCE_ADMIN','rift_force_admin','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/강제균열','RIFT_FORCE_ADMIN',1),('/강제대균열','RIFT_FORCE_ADMIN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
