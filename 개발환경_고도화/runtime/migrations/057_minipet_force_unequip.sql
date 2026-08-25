INSERT INTO admin_permissions (code, display_name) VALUES
  ('minipet.force_unequip', '미니펫 강제 장착 해제')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, 'minipet.force_unequip'
FROM admin_roles role
WHERE role.code = 'super_admin'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);

CREATE TABLE mini_pet_force_unequip_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  stable_owned_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  after_sort_index SMALLINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_minipet_force_unequip_player (player_id, created_at),
  KEY ix_minipet_force_unequip_owned (owned_mini_pet_id, created_at),
  CONSTRAINT fk_minipet_force_unequip_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_force_unequip_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_force_unequip_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_force_unequip_owned FOREIGN KEY (owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_force_unequip_sort CHECK (after_sort_index BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
