ALTER TABLE external_identity_names
  ADD COLUMN source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'legacy_unknown' AFTER display_name,
  ADD COLUMN trust_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'untrusted' AFTER source_code,
  ADD COLUMN channel_id BIGINT UNSIGNED NULL AFTER trust_status,
  ADD COLUMN provider_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER channel_id,
  ADD CONSTRAINT chk_external_identity_name_trust CHECK (trust_status IN ('untrusted', 'candidate', 'verified', 'rejected')),
  ADD CONSTRAINT fk_external_identity_name_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  ADD UNIQUE KEY uq_external_identity_name_event (external_identity_id, source_code, provider_event_id);

UPDATE external_identity_names
SET source_code = 'iris_cache', trust_status = 'untrusted'
WHERE source_code = 'legacy_unknown';

UPDATE external_identities AS identity
SET identity.display_name = NULL
WHERE identity.status = 'candidate'
  AND EXISTS (
    SELECT 1
    FROM external_identity_names AS observed
    WHERE observed.external_identity_id = identity.id
      AND observed.source_code = 'iris_cache'
      AND observed.display_name = identity.display_name
  );

ALTER TABLE channel_memberships
  ADD COLUMN left_at DATETIME(3) NULL AFTER joined_at;

CREATE TABLE normalized_provider_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(128) NOT NULL,
  event_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_provider_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_normalized_provider_event (event_id),
  KEY idx_normalized_provider_event_code_created (event_code, created_at),
  KEY idx_normalized_provider_event_target (target_provider_event_id),
  CONSTRAINT fk_normalized_provider_event_inbox FOREIGN KEY (event_id) REFERENCES event_inbox (event_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_membership_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(128) NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  membership_event_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_membership_event (event_id),
  KEY idx_channel_membership_event_channel_time (channel_id, occurred_at),
  CONSTRAINT chk_channel_membership_event_code CHECK (membership_event_code IN ('joined', 'departed')),
  CONSTRAINT fk_channel_membership_event_inbox FOREIGN KEY (event_id) REFERENCES event_inbox (event_id) ON DELETE RESTRICT,
  CONSTRAINT fk_channel_membership_event_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT fk_channel_membership_event_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE moderation_incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(128) NOT NULL,
  channel_id BIGINT UNSIGNED NULL,
  external_identity_id BIGINT UNSIGNED NULL,
  incident_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_provider_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'detected',
  occurred_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_moderation_incident_event (event_id),
  KEY idx_moderation_incident_status_time (status, occurred_at),
  CONSTRAINT chk_moderation_incident_type CHECK (incident_type IN ('message_edited', 'message_deleted')),
  CONSTRAINT chk_moderation_incident_status CHECK (status IN ('detected', 'reviewed', 'dismissed')),
  CONSTRAINT fk_moderation_incident_event FOREIGN KEY (event_id) REFERENCES event_inbox (event_id) ON DELETE RESTRICT,
  CONSTRAINT fk_moderation_incident_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT fk_moderation_incident_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_moderation_incident_reviewer FOREIGN KEY (reviewed_by) REFERENCES admin_operators (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_activity_daily (
  channel_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  activity_date DATE NOT NULL,
  message_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  media_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reply_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mention_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  event_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_event_at DATETIME(3) NOT NULL,
  PRIMARY KEY (channel_id, external_identity_id, activity_date),
  KEY idx_channel_activity_date_count (activity_date, message_count, media_count),
  CONSTRAINT fk_channel_activity_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT fk_channel_activity_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions (code, display_name) VALUES
  ('activity.read', '채널 활동 조회'),
  ('incident.read', '감지 사건 조회')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles AS role
JOIN admin_permissions AS permission ON permission.code IN ('activity.read', 'incident.read')
WHERE role.code IN ('super_admin', 'manager')
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
