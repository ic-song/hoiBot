-- WBS746 Gate 2 additive platform identity, context, membership, and nickname history model.

CREATE TABLE IF NOT EXISTS account_platform_identities (
  platform_identity_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  portal_account_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_scope_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  external_user_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  identity_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (platform_identity_id),
  UNIQUE KEY uq_amgp_468_platform_identity (platform_code, identity_scope_key, external_user_key),
  KEY idx_amgp_468_identity_portal (portal_account_id, identity_status),
  CONSTRAINT fk_amgp_468_identity_portal FOREIGN KEY (portal_account_id) REFERENCES canonical_portal_accounts (portal_account_id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_468_platform_code CHECK (platform_code IN ('KAKAO','DISCORD')),
  CONSTRAINT chk_amgp_468_identity_status CHECK (identity_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  CONSTRAINT chk_amgp_468_identity_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_468_identity_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_platform_contexts (
  platform_context_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  context_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_context_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  context_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (platform_context_id),
  UNIQUE KEY uq_amgp_468_platform_context (platform_code, context_type, external_context_key),
  CONSTRAINT chk_amgp_468_context_pair CHECK ((platform_code = 'KAKAO' AND context_type = 'ROOM') OR (platform_code = 'DISCORD' AND context_type = 'SERVER')),
  CONSTRAINT chk_amgp_468_context_status CHECK (context_status IN ('ACTIVE','SUSPENDED','CLOSED')),
  CONSTRAINT chk_amgp_468_context_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_468_context_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_platform_context_memberships (
  platform_context_membership_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_identity_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_context_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (platform_context_membership_id),
  UNIQUE KEY uq_amgp_468_identity_context (platform_identity_id, platform_context_id),
  CONSTRAINT fk_amgp_468_membership_identity FOREIGN KEY (platform_identity_id) REFERENCES account_platform_identities (platform_identity_id) ON DELETE RESTRICT,
  CONSTRAINT fk_amgp_468_membership_context FOREIGN KEY (platform_context_id) REFERENCES account_platform_contexts (platform_context_id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_468_membership_status CHECK (membership_status IN ('ACTIVE','SUSPENDED','LEFT')),
  CONSTRAINT chk_amgp_468_membership_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_468_membership_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_platform_nickname_observations (
  platform_nickname_observation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_context_membership_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  observed_nickname VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  observation_source VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (platform_nickname_observation_id),
  KEY idx_amgp_468_nickname_membership (platform_context_membership_id, INSERT_TIME),
  CONSTRAINT fk_amgp_468_nickname_membership FOREIGN KEY (platform_context_membership_id) REFERENCES account_platform_context_memberships (platform_context_membership_id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_468_nickname_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_468_nickname_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
