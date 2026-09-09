CREATE TABLE IF NOT EXISTS pre_signup_attendance_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  command_code VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  game_server_id BIGINT UNSIGNED NULL,
  affected_count INT UNSIGNED NOT NULL DEFAULT 0,
  remaining_count INT UNSIGNED NOT NULL DEFAULT 0,
  run_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pre_signup_attendance_run_operation (operation_id),
  CONSTRAINT fk_pre_signup_attendance_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_pre_signup_attendance_run_server FOREIGN KEY (game_server_id) REFERENCES game_servers(id),
  CONSTRAINT ck_pre_signup_attendance_run_status CHECK (run_status IN ('processing','complete','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS pre_signup_attendance_mutations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  attendance_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  before_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  after_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  before_game_server_id BIGINT UNSIGNED NULL,
  after_game_server_id BIGINT UNSIGNED NULL,
  before_version BIGINT UNSIGNED NOT NULL,
  after_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pre_signup_attendance_mutation (run_id,attendance_id),
  CONSTRAINT fk_pre_signup_attendance_mutation_run FOREIGN KEY (run_id) REFERENCES pre_signup_attendance_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_pre_signup_attendance_mutation_attendance FOREIGN KEY (attendance_id) REFERENCES pre_signup_attendance(id),
  CONSTRAINT fk_pre_signup_attendance_mutation_before_server FOREIGN KEY (before_game_server_id) REFERENCES game_servers(id),
  CONSTRAINT fk_pre_signup_attendance_mutation_after_server FOREIGN KEY (after_game_server_id) REFERENCES game_servers(id),
  CONSTRAINT ck_pre_signup_attendance_action CHECK (action_code IN ('cleanup_joined','cleanup_stale','server_reset'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO admin_permissions(code,display_name) VALUES ('pre_signup_attendance.manage','미가입 출첵 조회·정리·서버 초기화') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT id,'pre_signup_attendance.manage' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('ADMIN_PRE_SIGNUP_CLEANUP','admin_pre_signup_cleanup','VERIFIED_USER','SHADOW',TRUE,1),
  ('ADMIN_PRE_SIGNUP_SERVER_RESET','admin_pre_signup_server_reset','VERIFIED_USER','SHADOW',TRUE,1),
  ('ADMIN_PRE_SIGNUP_IDENTITY_LOOKUP','admin_pre_signup_identity_lookup','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/미가입출첵','ADMIN_PRE_SIGNUP_CLEANUP',TRUE),
  ('/미가입출첵서버초기화','ADMIN_PRE_SIGNUP_SERVER_RESET',TRUE),
  ('/미정','ADMIN_PRE_SIGNUP_IDENTITY_LOOKUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
