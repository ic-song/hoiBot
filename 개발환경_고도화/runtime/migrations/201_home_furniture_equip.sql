START TRANSACTION;

CREATE TABLE home_furniture_equip_policy (
  policy_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  large_floor_threshold BIGINT UNSIGNED NOT NULL,
  small_floor_divisor BIGINT UNSIGNED NOT NULL,
  small_floor_base_slots BIGINT UNSIGNED NOT NULL,
  large_floor_base_slots BIGINT UNSIGNED NOT NULL,
  large_floor_divisor BIGINT UNSIGNED NOT NULL,
  building_owner_bonus BIGINT UNSIGNED NOT NULL,
  god_building_owner_bonus BIGINT UNSIGNED NOT NULL,
  premium_bonus BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_furniture_equip_policy
  (policy_key,large_floor_threshold,small_floor_divisor,small_floor_base_slots,large_floor_base_slots,large_floor_divisor,building_owner_bonus,god_building_owner_bonus,premium_bonus)
VALUES('default',100,5,1,21,10,10,15,3);

CREATE TABLE home_furniture_equip_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  furniture_instance_id BIGINT UNSIGNED NOT NULL,
  requested_index BIGINT UNSIGNED NOT NULL,
  placed_count_before BIGINT UNSIGNED NOT NULL,
  placed_count_after BIGINT UNSIGNED NOT NULL,
  slot_limit BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_home_furniture_equip_instance(furniture_instance_id),
  KEY idx_home_furniture_equip_player_created(player_id,created_at),
  CONSTRAINT fk_home_furniture_equip_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_furniture_equip_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_furniture_equip_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_FURNITURE_EQUIP','home_furniture_equip','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/가구장착','HOME_FURNITURE_EQUIP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
