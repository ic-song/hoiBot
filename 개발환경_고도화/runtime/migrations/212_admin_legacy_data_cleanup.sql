START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('game.data.cleanup','레거시 데이터 정리')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'game.data.cleanup' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT 'ITEM-TERRITORY-ATTACK','영지공격권⚔','ITEM',TRUE,JSON_OBJECT('source','legacy-data-cleanup','canonical',TRUE),TRUE,1
WHERE NOT EXISTS(SELECT 1 FROM item_definitions WHERE display_name='영지공격권⚔');
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT 'ITEM-TERRITORY-AMBUSH-10','영지기습공격권🔥(10%)','ITEM',TRUE,JSON_OBJECT('source','legacy-data-cleanup','canonical',TRUE),TRUE,1
WHERE NOT EXISTS(SELECT 1 FROM item_definitions WHERE display_name='영지기습공격권🔥(10%)');
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT 'ITEM-TERRITORY-DEFENSE-20','영지절대방어권🛡(20%)','ITEM',TRUE,JSON_OBJECT('source','legacy-data-cleanup','canonical',TRUE),TRUE,1
WHERE NOT EXISTS(SELECT 1 FROM item_definitions WHERE display_name='영지절대방어권🛡(20%)');
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT 'ITEM-TERRITORY-AMBUSH-40','영지기습공격권🔥(40%)','ITEM',TRUE,JSON_OBJECT('source','legacy-data-cleanup','canonical',TRUE),TRUE,1
WHERE NOT EXISTS(SELECT 1 FROM item_definitions WHERE display_name='영지기습공격권🔥(40%)');
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT 'ITEM-TERRITORY-DEFENSE-50','영지절대방어권🛡(50%)','ITEM',TRUE,JSON_OBJECT('source','legacy-data-cleanup','canonical',TRUE),TRUE,1
WHERE NOT EXISTS(SELECT 1 FROM item_definitions WHERE display_name='영지절대방어권🛡(50%)');

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('ITEM-LEGACY-GUILD-RING','레거시 길드창고 반지','ITEM',TRUE,JSON_OBJECT('source','legacy-guild-warehouse.ring','cleanupOnly',TRUE),FALSE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),metadata_json=VALUES(metadata_json),active=FALSE;

CREATE TABLE legacy_data_cleanup_item_mappings (
  mapping_order INT UNSIGNED NOT NULL,
  source_display_name VARCHAR(191) NOT NULL,
  target_display_name VARCHAR(191) NOT NULL,
  PRIMARY KEY(mapping_order),
  UNIQUE KEY uq_legacy_data_cleanup_source(source_display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO legacy_data_cleanup_item_mappings(mapping_order,source_display_name,target_display_name) VALUES
  (1,'캐슬공격권⚔','영지공격권⚔'),
  (2,'캐슬기습공격권🔥(60%)','영지기습공격권🔥(10%)'),
  (3,'캐슬절대방어권🛡(50%)','영지절대방어권🛡(20%)'),
  (4,'캐슬기습공격권🔥(100%)','영지기습공격권🔥(40%)'),
  (5,'캐슬절대방어권🛡(100%)','영지절대방어권🛡(50%)');

CREATE TABLE legacy_data_cleanup_runs (
  request_key VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  item_quantity_moved BIGINT UNSIGNED NOT NULL,
  point_user_count BIGINT UNSIGNED NOT NULL,
  point_removed DECIMAL(30,3) NOT NULL,
  user_ring_removed BIGINT UNSIGNED NOT NULL,
  guild_ring_guild_count BIGINT UNSIGNED NOT NULL,
  guild_ring_quantity BIGINT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(request_key),
  UNIQUE KEY uq_legacy_data_cleanup_operation(operation_id),
  CONSTRAINT fk_legacy_data_cleanup_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_legacy_data_cleanup_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id),
  CONSTRAINT chk_legacy_data_cleanup_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_data_cleanup_item_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  source_item_id BIGINT UNSIGNED NOT NULL,
  target_item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  CONSTRAINT fk_legacy_cleanup_item_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_legacy_cleanup_item_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_legacy_cleanup_item_source FOREIGN KEY(source_item_id) REFERENCES item_definitions(id),
  CONSTRAINT fk_legacy_cleanup_item_target FOREIGN KEY(target_item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_data_cleanup_point_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  balance_before DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  removed_fraction DECIMAL(30,3) NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  CONSTRAINT fk_legacy_cleanup_point_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_legacy_cleanup_point_player FOREIGN KEY(player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_data_cleanup_ring_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  CONSTRAINT fk_legacy_cleanup_ring_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_legacy_cleanup_ring_player FOREIGN KEY(player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legacy_data_cleanup_guild_ring_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,sequence_no),
  CONSTRAINT fk_legacy_cleanup_guild_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_legacy_cleanup_guild FOREIGN KEY(guild_id) REFERENCES guilds(id),
  CONSTRAINT fk_legacy_cleanup_guild_item FOREIGN KEY(item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_LEGACY_DATA_CLEANUP','ADMIN_LEGACY_DATA_CLEANUP','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/데이터정리','ADMIN_LEGACY_DATA_CLEANUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
