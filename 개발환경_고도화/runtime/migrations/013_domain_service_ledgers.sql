CREATE TABLE guild_warehouse_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity_delta BIGINT NOT NULL,
  quantity_after BIGINT UNSIGNED NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_warehouse_ledger_operation_sequence (operation_id, sequence_no),
  KEY idx_guild_warehouse_ledger_asset (guild_id, item_id, created_at),
  CONSTRAINT fk_guild_warehouse_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_warehouse_ledger_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_warehouse_ledger_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_activity_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  home_player_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  activity_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reference_id BIGINT UNSIGNED NULL,
  detail_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_home_activity_operation (operation_id),
  KEY idx_home_activity_owner_created (home_player_id, created_at),
  CONSTRAINT fk_home_activity_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_activity_home FOREIGN KEY (home_player_id) REFERENCES player_homes (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_activity_actor FOREIGN KEY (actor_player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions (code, display_name) VALUES
  ('game.currency.change', '회원 재화 변경'),
  ('game.inventory.change', '회원 인벤토리 변경'),
  ('game.pet.change', '회원 펫 변경'),
  ('game.guild.change', '길드 변경'),
  ('game.home.moderate', '홈 활동 관리'),
  ('game.event.change', '이벤트 및 랭킹 변경'),
  ('game.market.change', '거래소 변경')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT role.id, permission.code
FROM admin_roles role CROSS JOIN admin_permissions permission
WHERE role.code = 'administrator' AND permission.code LIKE 'game.%'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
