START TRANSACTION;

CREATE TABLE mini_pet_admin_deletions (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  source_bag_sequence BIGINT UNSIGNED NOT NULL,
  owned_version_before BIGINT UNSIGNED NOT NULL,
  removed_title_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reindexed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  deleted_snapshot_json JSON NOT NULL,
  title_assignments_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_mini_pet_admin_delete_asset (owned_mini_pet_id, created_at),
  CONSTRAINT fk_mini_pet_admin_delete_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_delete_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_delete_player FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_delete_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name)
VALUES ('mini_pet.admin_owned.delete','운영자 소유 미니펫 지정 삭제')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'mini_pet.admin_owned.delete' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('MINI_PET_ADMIN_OWNED_DELETE','mini_pet_admin_owned_delete','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/미니펫삭제','MINI_PET_ADMIN_OWNED_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
