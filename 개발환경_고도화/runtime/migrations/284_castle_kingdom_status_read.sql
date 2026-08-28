START TRANSACTION;

ALTER TABLE castle_state
  ADD COLUMN lord_player_id BIGINT UNSIGNED NULL AFTER lord_guild_name,
  ADD COLUMN earnings DECIMAL(30,0) NOT NULL DEFAULT 0 AFTER lord_player_id,
  ADD KEY ix_castle_state_lord_player (lord_player_id),
  ADD CONSTRAINT fk_castle_state_lord_player FOREIGN KEY (lord_player_id) REFERENCES players(id) ON DELETE RESTRICT;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('CASTLE_KINGDOM_STATUS_READ','castle_kingdom_status_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/호월킹덤','CASTLE_KINGDOM_STATUS_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
