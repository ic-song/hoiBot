CREATE TABLE IF NOT EXISTS db_connection_probes (
  probe_id VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (probe_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_inbox (
  event_id VARCHAR(128) NOT NULL,
  event_kind VARCHAR(64) NOT NULL,
  processing_status VARCHAR(32) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  processed_at DATETIME(3) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id),
  KEY idx_event_inbox_status_received (processing_status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kakao_user_id VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_users_kakao_user_id (kakao_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kakao_chat_id VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_rooms_kakao_chat_id (kakao_chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_memberships (
  room_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  joined_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT fk_room_memberships_room FOREIGN KEY (room_id) REFERENCES bot_rooms (id),
  CONSTRAINT fk_room_memberships_user FOREIGN KEY (user_id) REFERENCES bot_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
