ALTER TABLE player_counters
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER value;

CREATE TABLE player_counter_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  counter_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_delta BIGINT NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_counter_ledger_operation_sequence (operation_id, sequence_no),
  CONSTRAINT fk_player_counter_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_counter_ledger_counter FOREIGN KEY (player_id, counter_code, period_key)
    REFERENCES player_counters(player_id, counter_code, period_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES ('tower_booster_package', '시탑부스터패키지', 'legacy_bag_item', TRUE,
  JSON_OBJECT('legacyName', '시탑부스터패키지', 'packageCatalogCode', 'tower_booster_package'), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable), metadata_json=VALUES(metadata_json), active=VALUES(active);

INSERT INTO package_definitions(code, display_name, price_currency_code, price_amount, purchase_limit, starts_at, ends_at, active)
VALUES ('tower_booster_package', '시탑부스터패키지', NULL, NULL, NULL, NULL, NULL, FALSE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_permissions(code, display_name) VALUES
  ('booster.counter.grant', '경험치 부스터 횟수 지급'),
  ('booster.package.grant', '시탑 부스터 패키지 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT role.id, permission.code FROM admin_roles role JOIN admin_permissions permission
  ON permission.code IN ('booster.counter.grant','booster.package.grant')
WHERE role.code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
