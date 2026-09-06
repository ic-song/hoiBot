-- WBS752: legacy /선물전달을 canonical item ownership과 재생 가능한 typed receipt로 재통합합니다.

SET @migration_479_preflight=IF(EXISTS(SELECT 1 FROM command_registry WHERE command_code='ADMIN_GLOBAL_GIFT') OR EXISTS(SELECT 1 FROM command_aliases WHERE command_text='/선물전달') OR EXISTS(SELECT 1 FROM admin_permissions WHERE code='game.inventory.global_gift'),'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT=''ADMIN_GLOBAL_GIFT_REGISTRY_ALREADY_EXISTS''','DO 0');
PREPARE migration_479_statement FROM @migration_479_preflight;
EXECUTE migration_479_statement;
DEALLOCATE PREPARE migration_479_statement;

SET @migration_479_existing_item_id=(SELECT binding.item_id FROM canonical_item_definition_imports binding WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND BINARY binding.source_identifier=BINARY '호이응원패키지(무료)🐹[2]' LIMIT 1);
SET @migration_479_preflight=IF(@migration_479_existing_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM canonical_item_definitions item WHERE item.item_id=@migration_479_existing_item_id AND BINARY item.item_name=BINARY '호이응원패키지(무료)🐹[2]' AND item.stackable_flag=TRUE AND item.active_flag=TRUE AND JSON_UNQUOTE(JSON_EXTRACT(item.definition_options,'$.sourceObjectKey'))='item.direct_bag.8349df1a3be0b247'),'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT=''ADMIN_GLOBAL_GIFT_ITEM_SOURCE_DRIFT''','DO 0');
PREPARE migration_479_statement FROM @migration_479_preflight;
EXECUTE migration_479_statement;
DEALLOCATE PREPARE migration_479_statement;

SET @migration_479_preflight=IF(@migration_479_existing_item_id IS NULL AND (EXISTS(SELECT 1 FROM canonical_item_definitions WHERE item_id='j7uyw6vc') OR EXISTS(SELECT 1 FROM canonical_item_definition_imports WHERE item_definition_import_id='phk8c656')),'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT=''ADMIN_GLOBAL_GIFT_SEED_ID_COLLISION''','DO 0');
PREPARE migration_479_statement FROM @migration_479_preflight;
EXECUTE migration_479_statement;
DEALLOCATE PREPARE migration_479_statement;

INSERT INTO canonical_item_definitions(item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
SELECT 'j7uyw6vc','호이응원패키지(무료)🐹[2]',NULL,'PACKAGE_ITEM',NULL,NULL,NULL,TRUE,TRUE,
  JSON_OBJECT('sourceObjectKey','item.direct_bag.8349df1a3be0b247','legacyBoundaryCode','ITEM-FREE-HOI-SUPPORT-02','legacySourceIndex',165,'legacySourceLines',JSON_ARRAY(6981,6982,6984),'legacySourceHash','10b21ddf32092b4b2c4450664694644f89bcb9991bc0bae436d9582fcad13d6a'),
  'migration_479',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'),'migration_479',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s')
WHERE @migration_479_existing_item_id IS NULL;

INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
SELECT 'phk8c656','j7uyw6vc','LEGACY_JS','member.bag','호이응원패키지(무료)🐹[2]','migration_479',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'),'migration_479',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s')
WHERE @migration_479_existing_item_id IS NULL;

CREATE TABLE canonical_admin_global_gift_channel_configs (
  admin_global_gift_channel_config_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_sequence TINYINT UNSIGNED NOT NULL,
  destination_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  config_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (admin_global_gift_channel_config_id),
  UNIQUE KEY uq_odbt_479_01_sequence (channel_sequence),
  UNIQUE KEY uq_odbt_479_01_destination (destination_id),
  CONSTRAINT chk_odbt_479_01_sequence CHECK (channel_sequence BETWEEN 1 AND 11),
  CONSTRAINT chk_odbt_479_01_status CHECK (config_status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT chk_odbt_479_01_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_479_01_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_admin_global_gift_operations (
  admin_global_gift_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  request_identity_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recipient_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recipient_count BIGINT UNSIGNED NOT NULL,
  channel_count TINYINT UNSIGNED NOT NULL,
  announcement_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  terminal_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (admin_global_gift_operation_id),
  UNIQUE KEY uq_odbt_479_02_request (request_key),
  UNIQUE KEY uq_odbt_479_02_operation_key (operation_key),
  CONSTRAINT fk_odbt_479_02_item FOREIGN KEY (item_id) REFERENCES canonical_item_definitions(item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_479_02_operation_key FOREIGN KEY (operation_key) REFERENCES operations(operation_key) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_479_02_hash CHECK (request_identity_fingerprint REGEXP '^[0-9a-f]{64}$' AND payload_fingerprint REGEXP '^[0-9a-f]{64}$' AND request_fingerprint REGEXP '^[0-9a-f]{64}$' AND announcement_fingerprint REGEXP '^[0-9a-f]{64}$' AND (result_fingerprint IS NULL OR result_fingerprint REGEXP '^[0-9a-f]{64}$') AND (recipient_fingerprint IS NULL OR recipient_fingerprint REGEXP '^[0-9a-f]{64}$')),
  CONSTRAINT chk_odbt_479_02_state CHECK ((operation_status='PROCESSING' AND result_fingerprint IS NULL AND recipient_fingerprint IS NULL AND terminal_json IS NULL) OR (operation_status='STAGED' AND result_fingerprint IS NOT NULL AND recipient_fingerprint IS NOT NULL AND terminal_json IS NULL) OR (operation_status='COMPLETED' AND result_fingerprint IS NOT NULL AND recipient_fingerprint IS NOT NULL AND JSON_VALID(terminal_json))),
  CONSTRAINT chk_odbt_479_02_channels CHECK (channel_count=11),
  CONSTRAINT chk_odbt_479_02_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_479_02_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_admin_global_gift_recipients (
  admin_global_gift_recipient_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_global_gift_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_item_stack_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_sequence BIGINT UNSIGNED NOT NULL,
  quantity_before BIGINT UNSIGNED NOT NULL,
  quantity_after BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (admin_global_gift_recipient_id),
  UNIQUE KEY uq_odbt_479_03_player (admin_global_gift_operation_id,player_id),
  UNIQUE KEY uq_odbt_479_03_sequence (admin_global_gift_operation_id,recipient_sequence),
  CONSTRAINT fk_odbt_479_03_operation FOREIGN KEY (admin_global_gift_operation_id) REFERENCES canonical_admin_global_gift_operations(admin_global_gift_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_479_03_player FOREIGN KEY (player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_479_03_stack FOREIGN KEY (owned_item_stack_id) REFERENCES canonical_owned_item_stacks(owned_item_stack_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_479_03_quantity CHECK (recipient_sequence>0 AND quantity_after=quantity_before+1),
  CONSTRAINT chk_odbt_479_03_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_479_03_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_admin_global_gift_channel_snapshots (
  admin_global_gift_channel_snapshot_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_global_gift_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_global_gift_channel_config_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_sequence TINYINT UNSIGNED NOT NULL,
  destination_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (admin_global_gift_channel_snapshot_id),
  UNIQUE KEY uq_odbt_479_04_sequence (admin_global_gift_operation_id,channel_sequence),
  CONSTRAINT fk_odbt_479_04_operation FOREIGN KEY (admin_global_gift_operation_id) REFERENCES canonical_admin_global_gift_operations(admin_global_gift_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_odbt_479_04_config FOREIGN KEY (admin_global_gift_channel_config_id) REFERENCES canonical_admin_global_gift_channel_configs(admin_global_gift_channel_config_id) ON DELETE RESTRICT,
  CONSTRAINT chk_odbt_479_04_sequence CHECK (channel_sequence BETWEEN 1 AND 11),
  CONSTRAINT chk_odbt_479_04_payload CHECK (payload_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_odbt_479_04_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_odbt_479_04_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_permissions(code,display_name) VALUES('game.inventory.global_gift','전 회원 호이응원패키지 지급');
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'game.inventory.global_gift' FROM admin_roles WHERE code='super_admin';
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_GLOBAL_GIFT','admin_global_gift','VERIFIED_USER','SHADOW',TRUE,1);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/선물전달','ADMIN_GLOBAL_GIFT',TRUE);
