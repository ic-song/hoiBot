START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active)
VALUES('LETTER_STAMP','우표💌','item',TRUE,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,active=TRUE;

CREATE TABLE IF NOT EXISTS community_post_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  stamp_item_id BIGINT UNSIGNED NOT NULL,
  stamp_before BIGINT UNSIGNED NOT NULL,
  stamp_after BIGINT UNSIGNED NOT NULL,
  evicted_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  UNIQUE KEY uq_community_post_operation_post(post_id),
  CONSTRAINT fk_community_post_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_community_post_operation_post FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_community_post_operation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_community_post_operation_stamp FOREIGN KEY(stamp_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_board_clear_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  board_id BIGINT UNSIGNED NOT NULL,
  cleared_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_community_board_clear_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_community_board_clear_board FOREIGN KEY(board_id) REFERENCES community_boards(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_board_clear_lines (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  status_before VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deleted_at_before DATETIME(3) NULL,
  PRIMARY KEY(operation_id,sequence_no),
  UNIQUE KEY uq_community_board_clear_line_post(operation_id,post_id),
  CONSTRAINT fk_community_board_clear_line_operation FOREIGN KEY(operation_id) REFERENCES community_board_clear_operations(operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_community_board_clear_line_post FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name)
VALUES('social.letter_board.clear','전체 서버 편지 게시판 삭제')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'social.letter_board.clear' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
 ('SOCIAL_LETTER_BOARD_POST','letter_board','VERIFIED_USER','SHADOW',TRUE,1),
 ('SOCIAL_LETTER_BOARD_CLEAR','letter_board','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/편지','SOCIAL_LETTER_BOARD_POST',TRUE),('/편지삭제','SOCIAL_LETTER_BOARD_CLEAR',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
