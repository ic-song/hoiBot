CREATE TABLE IF NOT EXISTS home_activity_alert_reads (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  unread_before BIGINT UNSIGNED NOT NULL,
  stored_alert_count BIGINT UNSIGNED NOT NULL,
  recent_visitor_count BIGINT UNSIGNED NOT NULL,
  counter_after BIGINT UNSIGNED NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_home_alert_read_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_alert_read_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT chk_home_alert_read_snapshot CHECK(JSON_VALID(snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_ACTIVITY_ALERT_READ','home_activity_alert_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/홈알림','HOME_ACTIVITY_ALERT_READ',TRUE),('ㅎㄹ','HOME_ACTIVITY_ALERT_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
