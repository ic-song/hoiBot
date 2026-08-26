START TRANSACTION;

CREATE TABLE pendant_durability_corrections (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL,
  source_index INT UNSIGNED NOT NULL,
  durability_before INT UNSIGNED NOT NULL,
  durability_after INT UNSIGNED NOT NULL,
  max_durability INT UNSIGNED NOT NULL,
  instance_version_before BIGINT UNSIGNED NOT NULL,
  instance_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_pendant_durability_correction_instance_created (inventory_instance_id, created_at),
  CONSTRAINT fk_pendant_durability_correction_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_durability_correction_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_durability_correction_instance FOREIGN KEY (inventory_instance_id) REFERENCES inventory_instances (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES('pet.pendant.durability.correct','펜던트 내구도 보정')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet.pendant.durability.correct' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PENDANT_DURABILITY_CORRECTION','pendant_durability_correction','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펜던트내구도수정','PENDANT_DURABILITY_CORRECTION',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
