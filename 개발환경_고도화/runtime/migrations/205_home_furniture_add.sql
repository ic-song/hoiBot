START TRANSACTION;
CREATE TABLE home_furniture_add_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 operator_id BIGINT UNSIGNED NOT NULL,
 target_player_id BIGINT UNSIGNED NOT NULL,
 furniture_definition_id BIGINT UNSIGNED NOT NULL,
 furniture_instance_id BIGINT UNSIGNED NOT NULL,
 furniture_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 furniture_name_snapshot VARCHAR(191) NOT NULL,
 charm_snapshot BIGINT UNSIGNED NOT NULL,
 grade_display_name_snapshot VARCHAR(128) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_home_furniture_add_instance(furniture_instance_id),
 KEY idx_home_furniture_add_target_created(target_player_id,created_at),
 CONSTRAINT fk_home_furniture_add_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_add_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_add_target FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_add_definition FOREIGN KEY(furniture_definition_id) REFERENCES furniture_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_add_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('HOME_FURNITURE_ADD','home_furniture_add','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/가구추가','HOME_FURNITURE_ADD',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
