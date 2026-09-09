CREATE TABLE home_comment_pins (
  pin_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  home_player_id BIGINT UNSIGNED NOT NULL,
  comment_id BIGINT UNSIGNED NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  pinned_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  deleted_by_player_id BIGINT UNSIGNED NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  KEY idx_home_comment_pin_projection(home_player_id,deleted_at,display_order,pin_id),
  UNIQUE KEY uq_home_comment_pin_comment(home_player_id,comment_id),
  CONSTRAINT fk_home_comment_pin_home FOREIGN KEY(home_player_id) REFERENCES player_homes(player_id),
  CONSTRAINT fk_home_comment_pin_comment FOREIGN KEY(comment_id) REFERENCES home_comments(id),
  CONSTRAINT fk_home_comment_pin_deleted_by FOREIGN KEY(deleted_by_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_comment_pin_delete_mutations (
  request_key VARCHAR(191) NOT NULL PRIMARY KEY,
  operation_id BIGINT UNSIGNED NOT NULL UNIQUE,
  player_id BIGINT UNSIGNED NOT NULL,
  pin_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_home_pin_delete_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_pin_delete_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT chk_home_pin_delete_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_COMMENT_PIN_DELETE','HOME_COMMENT_PIN_DELETE','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/댓글핀삭제','HOME_COMMENT_PIN_DELETE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
