CREATE TABLE IF NOT EXISTS admin_explore_count_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  count_before BIGINT UNSIGNED NOT NULL,
  count_after BIGINT UNSIGNED NOT NULL,
  changed BOOLEAN NOT NULL,
  version_before BIGINT UNSIGNED NOT NULL,
  version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_admin_explore_count_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_explore_count_player FOREIGN KEY (target_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('admin.explore_count.manage','탐험 횟수 수정')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.explore_count.manage' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_EXPLORE_COUNT_UPDATE','admin_explore_count_update','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/탐험횟수수정','ADMIN_EXPLORE_COUNT_UPDATE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
