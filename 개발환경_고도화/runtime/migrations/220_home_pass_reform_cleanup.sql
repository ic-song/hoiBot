START TRANSACTION;

CREATE TABLE home_pass_reform_cleanup_state (
  cleanup_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  completed_operation_id BIGINT UNSIGNED NULL,
  completed_by_operator_id BIGINT UNSIGNED NULL,
  completed_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (cleanup_key),
  UNIQUE KEY uq_home_pass_reform_completed_operation (completed_operation_id),
  CONSTRAINT fk_home_pass_reform_state_operation FOREIGN KEY (completed_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_pass_reform_state_operator FOREIGN KEY (completed_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_pass_reform_cleanup_state(cleanup_key) VALUES('passBenefits20260726');

CREATE TABLE home_pass_reform_cleanup_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  cleanup_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  removed_comment_count BIGINT UNSIGNED NOT NULL,
  preserved_pinned_count BIGINT UNSIGNED NOT NULL,
  reset_like_user_count BIGINT UNSIGNED NOT NULL,
  reset_like_count BIGINT UNSIGNED NOT NULL,
  backed_up_comment_count BIGINT UNSIGNED NOT NULL,
  backed_up_home_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_pass_reform_run_actor (actor_operator_id,created_at),
  CONSTRAINT fk_home_pass_reform_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_pass_reform_run_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_pass_reform_comment_backups (
  operation_id BIGINT UNSIGNED NOT NULL,
  comment_id BIGINT UNSIGNED NOT NULL,
  home_player_id BIGINT UNSIGNED NOT NULL,
  author_player_id BIGINT UNSIGNED NOT NULL,
  body LONGTEXT NOT NULL,
  comment_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_created_at DATETIME(3) NOT NULL,
  comment_deleted_at DATETIME(3) NULL,
  pin_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  pin_display_order INT UNSIGNED NULL,
  PRIMARY KEY (operation_id,comment_id),
  KEY idx_home_pass_reform_comment_source (comment_id),
  CONSTRAINT fk_home_pass_reform_comment_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_pass_reform_home_backups (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  like_count BIGINT UNSIGNED NOT NULL,
  home_version BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,player_id),
  KEY idx_home_pass_reform_home_source (player_id),
  CONSTRAINT fk_home_pass_reform_home_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_PASS_REFORM_CLEANUP','home_pass_reform_cleanup','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫홈패스개편정리','HOME_PASS_REFORM_CLEANUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
