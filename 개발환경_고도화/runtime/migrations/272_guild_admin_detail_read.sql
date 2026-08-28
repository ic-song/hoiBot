START TRANSACTION;

CREATE TABLE guild_profile_details (
  guild_id BIGINT UNSIGNED NOT NULL,
  level_value BIGINT UNSIGNED NOT NULL DEFAULT 1,
  experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  territory_booster BIGINT UNSIGNED NOT NULL DEFAULT 0,
  join_condition_experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  recruitment_closed BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id),
  CONSTRAINT fk_guild_profile_details_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name)
VALUES('guild.detail.read','길드 상세정보 조회')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'guild.detail.read' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_ADMIN_DETAIL_READ','guild_admin_detail_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드상세정보','GUILD_ADMIN_DETAIL_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
