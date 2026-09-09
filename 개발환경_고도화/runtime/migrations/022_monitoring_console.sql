CREATE TABLE channel_name_observations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  observed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_channel_name_observation_channel_time (channel_id, observed_at),
  CONSTRAINT chk_channel_name_observation_source CHECK (source_code IN ('kakao_open_link', 'kakao_chat_room_meta')),
  CONSTRAINT fk_channel_name_observation_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions (code, display_name) VALUES
  ('monitoring.read', '오픈채팅 이벤트 모니터링 조회')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles AS role
JOIN admin_permissions AS permission ON permission.code = 'monitoring.read'
WHERE role.code IN ('super_admin', 'manager')
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
