CREATE TABLE user_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NULL,
  login_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  system_account_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  gender_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending_kakao_link',
  pending_expires_at DATETIME(3) NULL,
  activated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_accounts_login_id (login_id),
  UNIQUE KEY uq_user_accounts_system_name (system_account_name),
  UNIQUE KEY uq_user_accounts_player (player_id),
  KEY idx_user_accounts_status_expiry (status, pending_expires_at),
  CONSTRAINT fk_user_accounts_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_terms_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_account_id BIGINT UNSIGNED NOT NULL,
  terms_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  terms_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  accepted_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_terms_version (user_account_id, terms_type, terms_version),
  CONSTRAINT fk_user_terms_account FOREIGN KEY (user_account_id) REFERENCES user_accounts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_verification_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_account_id BIGINT UNSIGNED NOT NULL,
  provider_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hint CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  failed_attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  verified_external_identity_id BIGINT UNSIGNED NULL,
  verified_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_verification_public_id (public_id),
  UNIQUE KEY uq_user_verification_code_hash (code_hash),
  KEY idx_user_verification_hint (code_hint, status, expires_at),
  KEY idx_user_verification_account_status (user_account_id, purpose_code, status),
  KEY idx_user_verification_expiry (status, expires_at),
  CONSTRAINT fk_user_verification_account FOREIGN KEY (user_account_id) REFERENCES user_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_verification_identity FOREIGN KEY (verified_external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_account_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  idle_expires_at DATETIME(3) NOT NULL,
  absolute_expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_sessions_token_hash (token_hash),
  KEY idx_user_sessions_account (user_account_id, revoked_at),
  KEY idx_user_sessions_expiry (idle_expires_at, absolute_expires_at),
  CONSTRAINT fk_user_sessions_account FOREIGN KEY (user_account_id) REFERENCES user_accounts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
