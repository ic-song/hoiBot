ALTER TABLE player_profiles
  MODIFY level BIGINT NOT NULL DEFAULT 0;

INSERT INTO admin_permissions(code, display_name)
VALUES ('player.attribute.adjust', '회원 레벨·포인트 속성 조정')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT id, 'player.attribute.adjust' FROM admin_roles WHERE code = 'super_admin'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
