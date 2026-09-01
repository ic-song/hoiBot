START TRANSACTION;

CREATE TABLE admin_storage_limit_cleanup_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  mini_pet_removed_count BIGINT UNSIGNED NOT NULL,
  furniture_removed_count BIGINT UNSIGNED NOT NULL,
  pendant_removed_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_admin_storage_cleanup_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_storage_cleanup_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_storage_limit_cleanup_items (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  asset_type ENUM('mini_pet','furniture','pendant') NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  asset_id BIGINT UNSIGNED NOT NULL,
  asset_version_before BIGINT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id,sequence_no),
  KEY idx_admin_storage_cleanup_asset(asset_type,asset_id),
  KEY idx_admin_storage_cleanup_player(player_id,created_at),
  CONSTRAINT fk_admin_storage_cleanup_item_operation FOREIGN KEY(operation_id) REFERENCES admin_storage_limit_cleanup_runs(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_storage_cleanup_item_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES('admin.storage_limit_cleanup','전체 자산 가방 한도 정리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.storage_limit_cleanup' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_STORAGE_LIMIT_CLEANUP','admin_storage_limit_cleanup','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/글자수전체정리','ADMIN_STORAGE_LIMIT_CLEANUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
