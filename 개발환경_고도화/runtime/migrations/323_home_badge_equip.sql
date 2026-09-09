CREATE TABLE IF NOT EXISTS home_badge_equipment_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  definition_version_id BIGINT UNSIGNED NOT NULL,
  command_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_text VARCHAR(128) NULL,
  before_badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  after_badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_badge_equipment_player_created (player_id, created_at),
  CONSTRAINT fk_home_badge_equipment_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_badge_equipment_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_equipment_definition_version FOREIGN KEY (definition_version_id) REFERENCES home_badge_definition_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('HOME_BADGE_EQUIP','home_badge_equip','VERIFIED_USER','SHADOW',TRUE,1),
  ('HOME_BADGE_UNEQUIP','home_badge_equip','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE
  handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),
  enabled=VALUES(enabled),version=GREATEST(version,VALUES(version)),updated_at=UTC_TIMESTAMP(3);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/홈뱃지장착','HOME_BADGE_EQUIP',TRUE),
  ('/홈뱃지해제','HOME_BADGE_UNEQUIP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
