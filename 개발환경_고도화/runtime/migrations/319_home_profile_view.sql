CREATE TABLE IF NOT EXISTS home_profile_view_global_locks (
  lock_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY(lock_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_profile_visit_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  visit_count_after BIGINT UNSIGNED NOT NULL,
  recent_sequence_no INT UNSIGNED NOT NULL,
  awarded_badges_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_home_profile_visit_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_profile_visit_actor FOREIGN KEY(actor_player_id) REFERENCES players(id),
  CONSTRAINT fk_home_profile_visit_target FOREIGN KEY(target_player_id) REFERENCES players(id),
  CONSTRAINT chk_home_profile_visit_badges CHECK(JSON_VALID(awarded_badges_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_profile_view_reads (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  self_view BOOLEAN NOT NULL,
  reply_count INT UNSIGNED NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_home_profile_read_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_profile_read_actor FOREIGN KEY(actor_player_id) REFERENCES players(id),
  CONSTRAINT fk_home_profile_read_target FOREIGN KEY(target_player_id) REFERENCES players(id),
  CONSTRAINT chk_home_profile_read_snapshot CHECK(JSON_VALID(snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_profile_view_outbox_parts (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  outbox_id BIGINT UNSIGNED NOT NULL,
  section_code ENUM('home','feed','comments') NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  UNIQUE KEY uq_home_profile_part_outbox(outbox_id),
  CONSTRAINT fk_home_profile_part_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_profile_part_outbox FOREIGN KEY(outbox_id) REFERENCES outbox_messages(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO home_profile_view_global_locks(lock_code,version) VALUES('HOME_PROFILE_VIEW',1)
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_PROFILE_VIEW','home_profile_view','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펫홈','HOME_PROFILE_VIEW',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
