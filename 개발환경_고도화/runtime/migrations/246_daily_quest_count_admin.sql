CREATE TABLE IF NOT EXISTS admin_daily_quest_count_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  changed BOOLEAN NOT NULL,
  version_before BIGINT UNSIGNED NOT NULL,
  version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_admin_daily_quest_count_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_admin_daily_quest_count_player FOREIGN KEY (target_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('admin.daily_quest_count.manage','일일 퀘스트 횟수 수정')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'admin.daily_quest_count.manage' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_DAILY_QUEST_COUNT_UPDATE','admin_daily_quest_count_update','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/일퀘횟수수정','ADMIN_DAILY_QUEST_COUNT_UPDATE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
