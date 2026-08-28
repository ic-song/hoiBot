START TRANSACTION;

ALTER TABLE rng_events
  ADD COLUMN draw_sequence SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER operation_id,
  DROP INDEX uq_rng_events_operation,
  ADD UNIQUE KEY uq_rng_events_operation_sequence (operation_id,draw_sequence);

INSERT INTO admin_permissions(code,display_name)
VALUES('social.punch.react','명치한대 반응 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'social.punch.react' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('SOCIAL_PUNCH_REACTION','social_punch_reaction','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/명치한대','SOCIAL_PUNCH_REACTION',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
