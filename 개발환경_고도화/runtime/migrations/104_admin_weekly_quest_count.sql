CREATE TABLE IF NOT EXISTS admin_weekly_quest_count_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  mutation_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_player_id BIGINT UNSIGNED NULL,
  affected_player_count BIGINT UNSIGNED NOT NULL,
  total_before BIGINT UNSIGNED NOT NULL,
  before_json LONGTEXT NOT NULL,
  after_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_admin_weekly_count_mutation_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_weekly_count_mutation_player FOREIGN KEY (target_player_id) REFERENCES players(id),
  CONSTRAINT chk_admin_weekly_count_mutation_kind CHECK (mutation_kind IN ('update','reset')),
  CONSTRAINT chk_admin_weekly_count_before CHECK (JSON_VALID(before_json)),
  CONSTRAINT chk_admin_weekly_count_after CHECK (JSON_VALID(after_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_global_locks(lock_code) VALUES ('weekly_quest_count_reset')
ON DUPLICATE KEY UPDATE lock_code=VALUES(lock_code);

INSERT INTO admin_permissions(code,display_name)
VALUES ('admin.weekly_quest_count.manage','주간 퀘스트 횟수 수정·초기화')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.weekly_quest_count.manage' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_WEEKLY_QUEST_COUNT_MUTATE','admin_weekly_quest_count_mutate','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/주간횟수수정','ADMIN_WEEKLY_QUEST_COUNT_MUTATE',1),
  ('/주간횟수초기화','ADMIN_WEEKLY_QUEST_COUNT_MUTATE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
