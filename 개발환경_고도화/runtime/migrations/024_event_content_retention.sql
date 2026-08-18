CREATE TABLE retained_event_contents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(128) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  content_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_provider_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  message_text MEDIUMTEXT NULL,
  reply_source_text MEDIUMTEXT NULL,
  media_url TEXT NULL,
  storage_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  mime_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  byte_size BIGINT UNSIGNED NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  failure_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_retained_event_content_sequence (event_id, sequence_no),
  KEY idx_retained_event_content_expiry (status, expires_at),
  CONSTRAINT chk_retained_event_content_kind CHECK (content_kind IN ('reply', 'image', 'animated_sticker')),
  CONSTRAINT chk_retained_event_content_status CHECK (status IN ('pending', 'stored', 'metadata_only', 'failed', 'purged')),
  CONSTRAINT fk_retained_event_content_event FOREIGN KEY (event_id) REFERENCES event_inbox (event_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE retained_content_access_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  retained_content_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  access_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  accessed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_retained_content_access_operator_time (operator_id, accessed_at),
  CONSTRAINT chk_retained_content_access_kind CHECK (access_kind IN ('detail', 'media')),
  CONSTRAINT fk_retained_content_access_content FOREIGN KEY (retained_content_id) REFERENCES retained_event_contents (id) ON DELETE RESTRICT,
  CONSTRAINT fk_retained_content_access_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions (code, display_name) VALUES
  ('event.content.read', '보관된 이벤트 본문·미디어 조회')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles AS role
JOIN admin_permissions AS permission ON permission.code = 'event.content.read'
WHERE role.code IN ('super_admin', 'manager')
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
