CREATE TABLE players (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_players_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE external_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NULL,
  provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_user_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(191) NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'candidate',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_external_identity_provider_user (provider_code, external_user_id),
  KEY idx_external_identity_player (player_id),
  CONSTRAINT fk_external_identity_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE external_identity_names (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  observed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_identity_names_observed (external_identity_id, observed_at),
  CONSTRAINT fk_identity_names_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_channel_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  channel_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_channels_provider_channel (provider_code, external_channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_memberships (
  channel_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  joined_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (channel_id, external_identity_id),
  CONSTRAINT fk_channel_membership_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT fk_channel_membership_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_import_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_root_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legacy_import_run_key (run_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_import_files (
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_file VARCHAR(500) NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_count BIGINT UNSIGNED NULL,
  parse_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (import_run_id, source_file),
  CONSTRAINT fk_import_files_run FOREIGN KEY (import_run_id) REFERENCES legacy_import_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_import_anomalies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_file VARCHAR(500) NOT NULL,
  source_path VARCHAR(1000) NOT NULL,
  field_name VARCHAR(191) NULL,
  reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  detail_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_import_anomalies_run_reason (import_run_id, reason_code),
  CONSTRAINT fk_import_anomalies_run FOREIGN KEY (import_run_id) REFERENCES legacy_import_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_identity_map (
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_file VARCHAR(500) NOT NULL,
  legacy_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  candidate_external_identity_id BIGINT UNSIGNED NULL,
  resolution_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unresolved',
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME(3) NULL,
  PRIMARY KEY (import_run_id, source_file, legacy_key),
  CONSTRAINT fk_legacy_identity_run FOREIGN KEY (import_run_id) REFERENCES legacy_import_runs (id) ON DELETE RESTRICT,
  CONSTRAINT fk_legacy_identity_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_legacy_identity_candidate FOREIGN KEY (candidate_external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO players (id, status, version, created_at, updated_at)
SELECT id, status, 1, created_at, updated_at FROM bot_users
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO external_identities (player_id, provider_code, external_user_id, status, created_at, updated_at)
SELECT id, 'kakao', kakao_user_id, 'linked', created_at, updated_at FROM bot_users
ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), status = 'linked', updated_at = VALUES(updated_at);

INSERT INTO channels (id, provider_code, external_channel_id, channel_type, status, created_at, updated_at)
SELECT id, 'kakao', kakao_chat_id, 'group', status, created_at, updated_at FROM bot_rooms
ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = VALUES(updated_at);
