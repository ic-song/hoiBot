CREATE TABLE IF NOT EXISTS operation_notice_heads (
  set_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_configuration_set_id BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (set_code),
  CONSTRAINT fk_operation_notice_head_set FOREIGN KEY (active_configuration_set_id) REFERENCES configuration_sets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('operation.notice.manage','운영 공지 변경')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'operation.notice.manage' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO configuration_sets(set_code,version,status,effective_from)
SELECT 'operation_notices',1,'active',UTC_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM configuration_sets WHERE set_code='operation_notices');

INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value)
SELECT id,seed.config_key,'string',''
FROM configuration_sets
JOIN (
  SELECT 'notice.cleanup' config_key
  UNION ALL SELECT 'notice.package_bag'
) seed
WHERE set_code='operation_notices' AND version=1
ON DUPLICATE KEY UPDATE value_type='string',string_value=COALESCE(string_value,'');

INSERT INTO operation_notice_heads(set_code,active_configuration_set_id,version)
SELECT 'operation_notices',id,version FROM configuration_sets
WHERE set_code='operation_notices' AND status='active'
ORDER BY version DESC LIMIT 1
ON DUPLICATE KEY UPDATE active_configuration_set_id=VALUES(active_configuration_set_id),version=VALUES(version);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('OPERATION_NOTICE_CLEANUP_MUTATE','operation_notice_mutate','VERIFIED_USER','SHADOW',TRUE,1),
  ('OPERATION_NOTICE_PACKAGE_MUTATE','operation_notice_mutate','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/정리알림','OPERATION_NOTICE_CLEANUP_MUTATE',TRUE),
  ('/패키지알림','OPERATION_NOTICE_PACKAGE_MUTATE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
