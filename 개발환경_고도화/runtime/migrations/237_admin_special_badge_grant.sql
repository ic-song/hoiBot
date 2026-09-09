ALTER TABLE player_special_badge_mutations
  DROP CONSTRAINT chk_special_badge_mutation_kind,
  ADD CONSTRAINT chk_special_badge_mutation_kind CHECK (mutation_kind IN ('grant','revoke'));

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('pet_home.special_badge.grant','특별 펫홈 뱃지 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet_home.special_badge.grant' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_SPECIAL_BADGE_GRANT','admin_special_badge_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/특별뱃지지급','ADMIN_SPECIAL_BADGE_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
