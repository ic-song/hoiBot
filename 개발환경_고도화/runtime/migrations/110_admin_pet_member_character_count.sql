START TRANSACTION;

CREATE TABLE IF NOT EXISTS pet_member_storage_snapshots (
  snapshot_code VARCHAR(64) NOT NULL,
  raw_json LONGTEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  utf16_character_count BIGINT UNSIGNED NOT NULL,
  source_version VARCHAR(64) NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (snapshot_code),
  CONSTRAINT chk_pet_member_storage_snapshot_json CHECK (JSON_VALID(raw_json)),
  CONSTRAINT chk_pet_member_storage_snapshot_sha CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$')
);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_PET_MEMBER_CHARACTER_COUNT','admin_pet_member_character_count','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫멤버글자수','ADMIN_PET_MEMBER_CHARACTER_COUNT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
