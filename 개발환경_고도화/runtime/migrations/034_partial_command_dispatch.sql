CREATE TABLE IF NOT EXISTS command_registry (
  command_code VARCHAR(100) NOT NULL,
  handler_key VARCHAR(100) NOT NULL,
  auth_scope VARCHAR(40) NOT NULL,
  rollout_state VARCHAR(20) NOT NULL DEFAULT 'LEGACY_ONLY',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (command_code),
  CONSTRAINT chk_command_registry_auth_scope CHECK (auth_scope IN ('VERIFIED_USER', 'TRUSTED_DISPLAY_NAME')),
  CONSTRAINT chk_command_registry_rollout_state CHECK (rollout_state IN ('LEGACY_ONLY', 'SHADOW', 'CANARY', 'ACTIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS command_aliases (
  command_text VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  command_code VARCHAR(100) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (command_text),
  KEY idx_command_aliases_code (command_code),
  CONSTRAINT fk_command_aliases_registry FOREIGN KEY (command_code) REFERENCES command_registry(command_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS command_routing_decisions (
  routing_decision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(100) NOT NULL,
  message_hash CHAR(64) NOT NULL,
  command_code VARCHAR(100) NULL,
  route VARCHAR(30) NOT NULL,
  reason_code VARCHAR(60) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (routing_decision_id),
  UNIQUE KEY uq_command_routing_event_message (event_id, message_hash),
  KEY idx_command_routing_command_created (command_code, created_at),
  CONSTRAINT chk_command_routing_route CHECK (route IN ('MODERN', 'SHADOW', 'LEGACY_FALLBACK', 'REJECT')),
  CONSTRAINT fk_command_routing_registry FOREIGN KEY (command_code) REFERENCES command_registry(command_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry
  (command_code, handler_key, auth_scope, rollout_state, enabled, version)
VALUES
  ('USER_PROFILE_MY_INFO', 'USER_PROFILE', 'VERIFIED_USER', 'CANARY', 1, 1),
  ('USER_SIGNUP_FLOW', 'USER_SIGNUP', 'TRUSTED_DISPLAY_NAME', 'CANARY', 1, 1)
ON DUPLICATE KEY UPDATE
  handler_key = VALUES(handler_key), auth_scope = VALUES(auth_scope), version = VALUES(version);

INSERT INTO command_aliases (command_text, command_code, active)
VALUES
  ('/내정보', 'USER_PROFILE_MY_INFO', 1),
  ('/가입', 'USER_SIGNUP_FLOW', 1),
  ('시작한다', 'USER_SIGNUP_FLOW', 1),
  ('/시작한다', 'USER_SIGNUP_FLOW', 1),
  ('거절한다', 'USER_SIGNUP_FLOW', 1),
  ('/거절한다', 'USER_SIGNUP_FLOW', 1)
ON DUPLICATE KEY UPDATE command_code = VALUES(command_code), active = VALUES(active);
