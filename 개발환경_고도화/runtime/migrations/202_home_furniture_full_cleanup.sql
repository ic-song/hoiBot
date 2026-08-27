START TRANSACTION;

ALTER TABLE furniture_inventory_instances
  ADD KEY idx_furniture_full_cleanup (status, player_id, charm_snapshot DESC, furniture_definition_id, id);

CREATE TABLE home_furniture_full_cleanup_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  total_user_count BIGINT UNSIGNED NOT NULL,
  total_removed_count BIGINT UNSIGNED NOT NULL,
  standard_keep_limit BIGINT UNSIGNED NOT NULL,
  premium_keep_limit BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_home_furniture_full_cleanup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_furniture_full_cleanup_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_furniture_full_cleanup_players (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  bag_count_before BIGINT UNSIGNED NOT NULL,
  bag_limit BIGINT UNSIGNED NOT NULL,
  removed_count BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  KEY idx_home_furniture_full_cleanup_player(player_id),
  CONSTRAINT fk_home_furniture_full_cleanup_player_operation FOREIGN KEY(operation_id) REFERENCES home_furniture_full_cleanup_operations(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_furniture_full_cleanup_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_FURNITURE_FULL_CLEANUP','home_furniture_full_cleanup','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/가구전체정리','HOME_FURNITURE_FULL_CLEANUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
