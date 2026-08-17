CREATE TABLE user_account_external_identity_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  link_id BIGINT UNSIGNED NOT NULL,
  user_account_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  reason VARCHAR(500) NULL,
  challenge_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_external_link_history_link (link_id, created_at, id),
  KEY idx_external_link_history_account (user_account_id, created_at, id),
  CONSTRAINT fk_external_link_history_link FOREIGN KEY (link_id) REFERENCES user_account_external_identities (id) ON DELETE CASCADE,
  CONSTRAINT fk_external_link_history_account FOREIGN KEY (user_account_id) REFERENCES user_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_external_link_history_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_external_link_history_challenge FOREIGN KEY (challenge_id) REFERENCES user_verification_challenges (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO user_account_external_identity_history
  (link_id, user_account_id, external_identity_id, action_code, actor_type, actor_id, reason, challenge_id, created_at)
SELECT link.id, link.user_account_id, link.external_identity_id,
  CASE link.status WHEN 'blocked' THEN 'blocked' WHEN 'unlinked' THEN 'unlinked' ELSE 'linked' END,
  'system', NULL, '기존 외부 플랫폼 연결 이력 생성', link.linked_via_challenge_id,
  COALESCE(link.blocked_at, link.unlinked_at, link.linked_at)
FROM user_account_external_identities link;
