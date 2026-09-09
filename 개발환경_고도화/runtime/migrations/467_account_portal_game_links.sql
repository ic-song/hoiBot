-- WBS746 Gate 2 additive portal account and game account ownership model.

CREATE TABLE IF NOT EXISTS canonical_portal_accounts (
  portal_account_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_user_account_id BIGINT UNSIGNED NOT NULL,
  portal_account_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (portal_account_id),
  UNIQUE KEY uq_amgp_467_portal_legacy (legacy_user_account_id),
  CONSTRAINT fk_amgp_467_portal_legacy FOREIGN KEY (legacy_user_account_id) REFERENCES user_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_467_portal_status CHECK (portal_account_status IN ('PENDING','ACTIVE','SUSPENDED','DELETED')),
  CONSTRAINT chk_amgp_467_portal_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_467_portal_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_game_account_links (
  portal_game_account_link_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  portal_account_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  player_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_sequence INT UNSIGNED NOT NULL,
  link_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  active_representative_portal_account_id VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (CASE WHEN player_role = 'REPRESENTATIVE' AND link_status = 'ACTIVE' THEN RTRIM(portal_account_id) ELSE NULL END) STORED,
  active_linked_player_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN link_status = 'ACTIVE' THEN player_id ELSE NULL END) STORED,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (portal_game_account_link_id),
  UNIQUE KEY uq_amgp_467_portal_sequence (portal_account_id, registration_sequence),
  UNIQUE KEY uq_amgp_467_one_representative (active_representative_portal_account_id),
  UNIQUE KEY uq_amgp_467_one_portal_per_player (active_linked_player_id),
  KEY idx_amgp_467_portal_status (portal_account_id, link_status),
  CONSTRAINT fk_amgp_467_link_portal FOREIGN KEY (portal_account_id) REFERENCES canonical_portal_accounts (portal_account_id) ON DELETE RESTRICT,
  CONSTRAINT fk_amgp_467_link_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_467_player_role CHECK (player_role IN ('REPRESENTATIVE','SUB')),
  CONSTRAINT chk_amgp_467_link_status CHECK (link_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  CONSTRAINT chk_amgp_467_registration_sequence CHECK (registration_sequence > 0),
  CONSTRAINT chk_amgp_467_link_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_467_link_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
