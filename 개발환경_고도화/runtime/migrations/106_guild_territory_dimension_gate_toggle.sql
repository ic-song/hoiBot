CREATE TABLE IF NOT EXISTS guild_territory_war_control (
  control_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dimension_gate_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (control_code),
  CONSTRAINT fk_guild_territory_control_operator FOREIGN KEY (updated_by_operator_id) REFERENCES admin_operators(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_territory_dimension_gate_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  enabled_before BOOLEAN NOT NULL,
  enabled_after BOOLEAN NOT NULL,
  changed BOOLEAN NOT NULL,
  version_before BIGINT UNSIGNED NOT NULL,
  version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_guild_dimension_gate_operation FOREIGN KEY (operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO guild_territory_war_control(control_code,dimension_gate_enabled)
VALUES ('current',TRUE)
ON DUPLICATE KEY UPDATE control_code=VALUES(control_code);

INSERT INTO admin_permissions(code,display_name)
VALUES ('guild.territory.dimension_gate.configure','길드 영지전 차원의 문 설정')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'guild.territory.dimension_gate.configure' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_TERRITORY_DIMENSION_GATE_TOGGLE','guild_territory_dimension_gate_toggle','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/차원의문on','GUILD_TERRITORY_DIMENSION_GATE_TOGGLE',1),
  ('/차원의문온','GUILD_TERRITORY_DIMENSION_GATE_TOGGLE',1),
  ('/차원의문off','GUILD_TERRITORY_DIMENSION_GATE_TOGGLE',1),
  ('/차원의문오프','GUILD_TERRITORY_DIMENSION_GATE_TOGGLE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
