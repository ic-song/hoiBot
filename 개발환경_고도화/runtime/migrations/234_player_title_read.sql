START TRANSACTION;

ALTER TABLE player_titles
  ADD COLUMN IF NOT EXISTS acquisition_price DECIMAL(30,3) NOT NULL DEFAULT 0 AFTER display_order;

CREATE TABLE IF NOT EXISTS player_title_read_delegates (
  external_identity_id BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(external_identity_id),
  CONSTRAINT fk_player_title_read_delegate_identity FOREIGN KEY(external_identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name)
VALUES('player.title.read_any','다른 사용자 타이틀 목록 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'player.title.read_any' FROM admin_roles WHERE code IN('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('PLAYER_TITLE_LIST_READ','player_title_list_read','VERIFIED_USER','SHADOW',TRUE,1),
  ('PLAYER_TITLE_INFO_READ','player_title_info_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/타이틀목록','PLAYER_TITLE_LIST_READ',TRUE),
  ('/타이틀정보','PLAYER_TITLE_INFO_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
