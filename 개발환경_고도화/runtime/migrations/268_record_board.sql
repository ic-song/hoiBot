CREATE TABLE community_record_board_settings (
  id TINYINT UNSIGNED NOT NULL,
  broadcast_destination_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_record_board_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO community_record_board_settings(id,broadcast_destination_id) VALUES(1,NULL)
ON DUPLICATE KEY UPDATE id=VALUES(id);

CREATE TABLE community_record_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_player_id BIGINT UNSIGNED NOT NULL,
  author_name_snapshot VARCHAR(191) NOT NULL,
  body TEXT NOT NULL,
  legacy_date CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_order BIGINT UNSIGNED NOT NULL,
  important BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_record_entries_projection (status,display_order,id),
  CONSTRAINT fk_record_entry_author FOREIGN KEY (author_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_record_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entry_id BIGINT UNSIGNED NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  display_number INT UNSIGNED NULL,
  body_snapshot TEXT NULL,
  important_before BOOLEAN NULL,
  important_after BOOLEAN NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_record_operations_entry (entry_id),
  CONSTRAINT fk_record_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_operation_entry FOREIGN KEY (entry_id) REFERENCES community_record_entries(id),
  CONSTRAINT fk_record_operation_actor FOREIGN KEY (actor_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES('social.record_board.manage','운영 기록 관리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'social.record_board.manage' FROM admin_roles WHERE code IN ('manager','super_admin')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('SOCIAL_RECORD_BOARD_ADD','record_board','VERIFIED_USER','SHADOW',1,1),
('SOCIAL_RECORD_BOARD_READ','record_board','VERIFIED_USER','SHADOW',1,1),
('SOCIAL_RECORD_BOARD_IMPORTANT','record_board','VERIFIED_USER','SHADOW',1,1),
('SOCIAL_RECORD_BOARD_DELETE','record_board','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/기록','SOCIAL_RECORD_BOARD_ADD',1),('/기록실','SOCIAL_RECORD_BOARD_READ',1),('/빌런','SOCIAL_RECORD_BOARD_IMPORTANT',1),('/기록삭제','SOCIAL_RECORD_BOARD_DELETE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
