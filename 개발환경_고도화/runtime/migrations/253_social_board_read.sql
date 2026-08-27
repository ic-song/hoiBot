START TRANSACTION;

INSERT INTO community_boards(code,display_name,channel_id,board_type_code,active)
VALUES ('legacy_public_board','전체 서버 게시판',NULL,'public',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),board_type_code=VALUES(board_type_code),active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('SOCIAL_BOARD_READ','social_board_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/게시판','SOCIAL_BOARD_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
