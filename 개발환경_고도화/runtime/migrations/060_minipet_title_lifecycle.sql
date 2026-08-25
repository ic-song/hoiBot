ALTER TABLE mini_pet_title_owned_states
  ADD COLUMN sale_price DECIMAL(30,3) NOT NULL DEFAULT 10000000000.000 AFTER display_order;

CREATE TABLE mini_pet_title_admin_channel_scopes (
  environment_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_channel_id VARCHAR(191) NOT NULL,
  approved_by_operator_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  approved_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (environment_code, external_channel_id),
  CONSTRAINT fk_minipet_title_channel_approver FOREIGN KEY (approved_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_title_channel_environment CHECK (environment_code IN ('prod','dev')),
  CONSTRAINT ck_minipet_title_channel_status CHECK (status IN ('active','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_title_lifecycle_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_name_snapshot VARCHAR(191) NOT NULL,
  sale_price_snapshot DECIMAL(30,3) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  selected_before BOOLEAN NOT NULL,
  selected_after_stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_minipet_title_lifecycle_player (player_id,created_at),
  CONSTRAINT fk_minipet_title_lifecycle_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_lifecycle_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_lifecycle_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_lifecycle_definition FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_title_lifecycle_action CHECK (action_code IN ('add','remove')),
  CONSTRAINT ck_minipet_title_lifecycle_order CHECK (display_order BETWEEN 1 AND 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES ('minipet.title.manage','미니펫 타이틀 관리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'minipet.title.manage' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
