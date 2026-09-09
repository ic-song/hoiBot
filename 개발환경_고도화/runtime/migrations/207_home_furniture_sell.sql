START TRANSACTION;
CREATE TABLE home_furniture_sell_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 furniture_instance_id BIGINT UNSIGNED NOT NULL,
 selected_bag_index BIGINT UNSIGNED NOT NULL,
 furniture_name_snapshot VARCHAR(191) NOT NULL,
 charm_snapshot BIGINT UNSIGNED NOT NULL,
 grade_display_name_snapshot VARCHAR(128) NOT NULL,
 reward_point DECIMAL(30,3) NOT NULL,
 point_before DECIMAL(30,3) NOT NULL,
 point_after DECIMAL(30,3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_home_furniture_sell_instance(furniture_instance_id),
 KEY idx_home_furniture_sell_player_created(player_id,created_at),
 CONSTRAINT fk_home_furniture_sell_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sell_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sell_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('HOME_FURNITURE_SELL','home_furniture_sell','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/가구판매','HOME_FURNITURE_SELL',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
