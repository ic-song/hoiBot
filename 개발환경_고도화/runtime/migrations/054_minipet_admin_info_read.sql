CREATE TABLE mini_pet_admin_read_channel_scopes (
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_channel_id VARCHAR(191) NOT NULL,
  approved_by_operator_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  approved_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (environment_code, external_channel_id),
  CONSTRAINT fk_mini_pet_admin_channel_approver FOREIGN KEY (approved_by_operator_id)
    REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mini_pet_admin_channel_environment CHECK (environment_code IN ('prod', 'dev')),
  CONSTRAINT ck_mini_pet_admin_channel_status CHECK (status IN ('active', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
