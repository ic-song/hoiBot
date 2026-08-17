CREATE TABLE user_account_external_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_account_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  link_purpose_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  linked_via_challenge_id BIGINT UNSIGNED NULL,
  linked_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  unlinked_at DATETIME(3) NULL,
  blocked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_account_external_identity (external_identity_id),
  KEY idx_user_account_external_links (user_account_id, status),
  CONSTRAINT fk_user_account_external_link_account FOREIGN KEY (user_account_id) REFERENCES user_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_account_external_link_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_account_external_link_challenge FOREIGN KEY (linked_via_challenge_id) REFERENCES user_verification_challenges (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE user_verification_challenges
SET purpose_code = 'signup_link'
WHERE purpose_code = 'initial_link';

INSERT INTO user_account_external_identities
  (user_account_id, external_identity_id, link_purpose_code, status, linked_at, created_at, updated_at)
SELECT account_row.id, identity.id, 'signup_link', 'active',
  COALESCE(account_row.activated_at, identity.updated_at), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM user_accounts account_row
JOIN external_identities identity ON identity.player_id = account_row.player_id
WHERE account_row.player_id IS NOT NULL AND identity.status = 'linked'
ON DUPLICATE KEY UPDATE
  user_account_id = VALUES(user_account_id), status = 'active', unlinked_at = NULL, updated_at = UTC_TIMESTAMP(3);

INSERT INTO configuration_sets (set_code, version, status, effective_from, created_at)
VALUES ('site.external_platform', 1, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO configuration_values
  (configuration_set_id, config_key, value_type, integer_value, validation_json)
SELECT id, 'max_active_links', 'integer', 10, JSON_OBJECT('minimum', 1, 'maximum', 10)
FROM configuration_sets
WHERE set_code = 'site.external_platform' AND version = 1;
