START TRANSACTION;

CREATE TABLE home_furniture_clean_policy (
  policy_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_point DECIMAL(30,3) NOT NULL,
  PRIMARY KEY(policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_furniture_clean_policy(policy_key,reward_point)
VALUES('default',100000);

CREATE TABLE home_furniture_clean_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  furniture_instance_id BIGINT UNSIGNED NOT NULL,
  requested_index BIGINT UNSIGNED NOT NULL,
  placed_count_before BIGINT UNSIGNED NOT NULL,
  placed_count_after BIGINT UNSIGNED NOT NULL,
  placed_charm_after BIGINT UNSIGNED NOT NULL,
  grade_counts_after_json JSON NOT NULL,
  furniture_name_snapshot VARCHAR(191) NOT NULL,
  charm_snapshot BIGINT UNSIGNED NOT NULL,
  grade_display_name_snapshot VARCHAR(128) NOT NULL,
  instance_version_before BIGINT UNSIGNED NOT NULL,
  reward_point DECIMAL(30,3) NOT NULL,
  point_before DECIMAL(30,3) NOT NULL,
  point_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_home_furniture_clean_player_created(player_id,created_at),
  KEY idx_home_furniture_clean_instance(furniture_instance_id),
  CONSTRAINT fk_home_furniture_clean_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_furniture_clean_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_furniture_clean_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_FURNITURE_CLEAN','home_furniture_clean','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/집청소','HOME_FURNITURE_CLEAN',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
