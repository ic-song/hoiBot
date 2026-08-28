START TRANSACTION;

INSERT INTO mini_pet_grade_definitions(grade_code,display_name,grade_order) VALUES
('elite','엘리트',12),('master','마스터',13)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),grade_order=VALUES(grade_order),active=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3);

CREATE TABLE mini_pet_admin_grant_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  sale_price BIGINT UNSIGNED NOT NULL,
  base_experience BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_admin_grant_operation (operation_id),
  UNIQUE KEY uq_mini_pet_admin_grant_owned (owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_admin_grant_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_grant_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_grant_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_grant_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_admin_grant_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name)
VALUES('mini_pet.admin.grant','미니펫 직접 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'mini_pet.admin.grant' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_MINI_PET_DIRECT_GRANT','admin_mini_pet_direct_grant','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫추가','ADMIN_MINI_PET_DIRECT_GRANT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
