ALTER TABLE event_inbox
  ADD COLUMN provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'iris' AFTER event_id,
  ADD COLUMN provider_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER provider_code,
  ADD COLUMN external_channel_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER provider_event_id,
  ADD COLUMN external_user_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER external_channel_id,
  ADD COLUMN event_origin VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER event_kind,
  ADD COLUMN direction VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'incoming' AFTER event_origin,
  ADD COLUMN payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER direction,
  ADD COLUMN parse_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'parsed' AFTER payload_hash,
  ADD COLUMN error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER attempt_count,
  ADD COLUMN last_error_at DATETIME(3) NULL AFTER error_code,
  ADD UNIQUE KEY uq_event_inbox_provider_event (provider_code, provider_event_id);

CREATE TABLE operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_scope VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  actor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operations_key (operation_key),
  UNIQUE KEY uq_operations_idempotency (idempotency_scope, idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE command_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(128) NOT NULL,
  command_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  execution_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_command_executions_event_command (event_id, command_code),
  CONSTRAINT fk_command_executions_event FOREIGN KEY (event_id) REFERENCES event_inbox (event_id) ON DELETE RESTRICT,
  CONSTRAINT fk_command_executions_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE command_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  target_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(500) NULL,
  change_summary_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_command_audit_target_created (target_type, target_id, created_at),
  CONSTRAINT fk_command_audit_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE outbox_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  destination_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  message_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_status_available (status, available_at),
  CONSTRAINT fk_outbox_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE delivery_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  outbox_message_id BIGINT UNSIGNED NOT NULL,
  attempt_no INT UNSIGNED NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempted_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_attempt_number (outbox_message_id, attempt_no),
  CONSTRAINT fk_delivery_attempt_outbox FOREIGN KEY (outbox_message_id) REFERENCES outbox_messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
