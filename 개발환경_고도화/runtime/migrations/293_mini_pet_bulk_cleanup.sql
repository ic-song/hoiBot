CREATE TABLE mini_pet_inventory_limits (
  player_id BIGINT UNSIGNED NOT NULL,
  keep_count BIGINT UNSIGNED NOT NULL DEFAULT 100,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'legacy_projection',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_mini_pet_inventory_limit_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_protected_refs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  ref_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ref_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_protected_ref (owned_mini_pet_id,ref_type,ref_key),
  KEY idx_mini_pet_protected_ref_active (owned_mini_pet_id,active),
  CONSTRAINT fk_mini_pet_protected_ref_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_bulk_cleanup_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator_id BIGINT UNSIGNED NOT NULL,
  source_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affected_player_count INT UNSIGNED NOT NULL,
  removed_count INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  consumed_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cancelled_at DATETIME(3) NULL,
  cancelled_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mini_pet_bulk_cleanup_pending (operator_id,consumed_at,cancelled_at,expires_at),
  CONSTRAINT fk_mini_pet_bulk_cleanup_confirmation_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_bulk_cleanup_confirmation_lines (
  confirmation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  owned_version BIGINT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  PRIMARY KEY (confirmation_id,sequence_no),
  UNIQUE KEY uq_mini_pet_bulk_confirmation_owned (confirmation_id,owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_bulk_confirmation_line FOREIGN KEY (confirmation_id) REFERENCES mini_pet_bulk_cleanup_confirmations(id) ON DELETE CASCADE,
  CONSTRAINT fk_mini_pet_bulk_confirmation_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_bulk_cleanup_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  confirmation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affected_player_count INT UNSIGNED NOT NULL,
  removed_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_bulk_cleanup_run_operation (operation_id),
  CONSTRAINT fk_mini_pet_bulk_cleanup_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_bulk_cleanup_run_confirmation FOREIGN KEY (confirmation_id) REFERENCES mini_pet_bulk_cleanup_confirmations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_bulk_cleanup_run_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_bulk_cleanup_lines (
  cleanup_run_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  owned_version BIGINT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  PRIMARY KEY (cleanup_run_id,sequence_no),
  UNIQUE KEY uq_mini_pet_bulk_cleanup_owned (cleanup_run_id,owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_bulk_cleanup_line_run FOREIGN KEY (cleanup_run_id) REFERENCES mini_pet_bulk_cleanup_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_bulk_cleanup_line_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES('mini_pet.bulk_cleanup','전체 미니펫 가방 안전 정리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'mini_pet.bulk_cleanup' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_BULK_CLEANUP','mini_pet_bulk_cleanup','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/미니펫전체정리','MINI_PET_BULK_CLEANUP',TRUE),
('/미니펫전체정리 확인','MINI_PET_BULK_CLEANUP',TRUE),
('/미니펫전체정리 취소','MINI_PET_BULK_CLEANUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
