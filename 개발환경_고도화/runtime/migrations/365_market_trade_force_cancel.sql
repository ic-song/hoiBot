START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('market.free_market.force_cancel','자유시장 거래 강제취소')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'market.free_market.force_cancel'
  FROM admin_roles
 WHERE code IN ('administrator','manager','super_admin') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MARKET_TRADE_FORCE_CANCEL','free_market_force_cancel','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/거래소강제취소','MARKET_TRADE_FORCE_CANCEL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
