START TRANSACTION;
CREATE TABLE IF NOT EXISTS matzang_room_scopes (
  destination_id VARCHAR(191) PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('MATZZANG_BATTLE','matzang_battle','VERIFIED_USER','SHADOW',1,1),
('MATZZANG_RANK','matzang_rank','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/맞짱','MATZZANG_BATTLE',1),('ㅁㅁ','MATZZANG_BATTLE',1),('/맞짱순위','MATZZANG_RANK',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
COMMIT;
