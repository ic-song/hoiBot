CREATE TABLE IF NOT EXISTS developer_note_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  released_on DATE NOT NULL,
  entry_order BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_developer_note_version_date (version,released_on),
  UNIQUE KEY uq_developer_note_entry_order (entry_order),
  KEY ix_developer_note_active_order (active,entry_order,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_note_changes (
  entry_id BIGINT UNSIGNED NOT NULL,
  change_index INT UNSIGNED NOT NULL,
  change_text TEXT NOT NULL,
  PRIMARY KEY (entry_id,change_index),
  CONSTRAINT fk_developer_note_change_entry FOREIGN KEY (entry_id) REFERENCES developer_note_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES ('developer_note.read','개발자 노트 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'developer_note.read' FROM admin_roles WHERE code IN ('super_admin','manager') AND active=TRUE
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_DEVELOPER_NOTE_READ','admin_developer_note_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/개발자노트','ADMIN_DEVELOPER_NOTE_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
