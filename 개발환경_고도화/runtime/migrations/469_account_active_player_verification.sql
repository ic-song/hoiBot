-- WBS746 Gate 2 additive active-player selection, replay, and verification binding model.

CREATE TABLE IF NOT EXISTS account_platform_active_player_selections (
  active_player_selection_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_context_membership_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  portal_game_account_link_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_player_id BIGINT UNSIGNED NOT NULL,
  selection_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  selection_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (active_player_selection_id),
  UNIQUE KEY uq_amgp_469_one_selection_per_membership (platform_context_membership_id),
  KEY idx_amgp_469_active_player (active_player_id, selection_status),
  CONSTRAINT fk_amgp_469_selection_membership FOREIGN KEY (platform_context_membership_id) REFERENCES account_platform_context_memberships (platform_context_membership_id) ON DELETE RESTRICT,
  CONSTRAINT fk_amgp_469_selection_link FOREIGN KEY (portal_game_account_link_id) REFERENCES portal_game_account_links (portal_game_account_link_id) ON DELETE RESTRICT,
  CONSTRAINT fk_amgp_469_selection_player FOREIGN KEY (active_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_469_selection_status CHECK (selection_status IN ('ACTIVE','SUSPENDED','CLEARED')),
  CONSTRAINT chk_amgp_469_selection_version CHECK (selection_version > 0),
  CONSTRAINT chk_amgp_469_selection_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_469_selection_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_platform_operation_receipts (
  account_platform_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  portal_account_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_context_membership_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  operation_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (account_platform_operation_id),
  UNIQUE KEY uq_amgp_469_request (operation_kind, request_key),
  CONSTRAINT fk_amgp_469_receipt_portal FOREIGN KEY (portal_account_id) REFERENCES canonical_portal_accounts (portal_account_id) ON DELETE RESTRICT,
  CONSTRAINT fk_amgp_469_receipt_membership FOREIGN KEY (platform_context_membership_id) REFERENCES account_platform_context_memberships (platform_context_membership_id) ON DELETE RESTRICT,
  CONSTRAINT chk_amgp_469_operation_kind CHECK (operation_kind IN ('VERIFY_GAME_ACCOUNT','SWITCH_ACTIVE_PLAYER','OBSERVE_NICKNAME')),
  CONSTRAINT chk_amgp_469_operation_status CHECK (operation_status IN ('COMPLETED','REJECTED')),
  CONSTRAINT chk_amgp_469_receipt_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_amgp_469_receipt_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE user_verification_challenges
  ADD COLUMN target_player_id BIGINT UNSIGNED NULL AFTER user_account_id,
  ADD COLUMN expected_display_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER target_player_id,
  ADD COLUMN platform_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER provider_code,
  ADD COLUMN identity_scope_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER platform_code,
  ADD COLUMN context_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER identity_scope_key,
  ADD COLUMN external_context_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER context_type,
  ADD COLUMN verified_platform_identity_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER verified_external_identity_id,
  ADD COLUMN consumed_request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER consumed_at,
  ADD KEY idx_amgp_469_challenge_target (user_account_id, purpose_code, target_player_id, status),
  ADD CONSTRAINT fk_amgp_469_challenge_player FOREIGN KEY (target_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amgp_469_challenge_platform_identity FOREIGN KEY (verified_platform_identity_id) REFERENCES account_platform_identities (platform_identity_id) ON DELETE RESTRICT;
