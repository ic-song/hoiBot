START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES('player.verification.rank.read','인증 순위 조회') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'player.verification.rank.read' FROM admin_roles WHERE code IN('super_admin','manager') ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('PLAYER_VERIFICATION_RANK_READ','player_verification_rank_read','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/인증순위','PLAYER_VERIFICATION_RANK_READ',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
