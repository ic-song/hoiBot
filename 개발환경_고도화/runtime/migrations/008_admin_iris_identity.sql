CREATE TABLE admin_operator_external_identities (
  operator_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operator_id, external_identity_id),
  UNIQUE KEY uq_admin_operator_external_identity (external_identity_id),
  CONSTRAINT fk_admin_external_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_external_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
