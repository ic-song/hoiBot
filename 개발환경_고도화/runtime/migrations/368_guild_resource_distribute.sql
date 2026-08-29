CREATE TABLE IF NOT EXISTS guild_resource_distribution_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  leader_player_id BIGINT UNSIGNED NOT NULL,
  member_order_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_count INT UNSIGNED NOT NULL,
  selected_player_ids_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(selected_player_ids_json)),
  resource_snapshot_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(resource_snapshot_json)),
  result_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(result_json)),
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_guild_resource_distribution_event (event_key),
  CONSTRAINT fk_guild_resource_distribution_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_resource_distribution_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT fk_guild_resource_distribution_leader FOREIGN KEY (leader_player_id) REFERENCES players(id),
  CONSTRAINT chk_guild_resource_distribution_recipient CHECK (recipient_count>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_resource_distribution_recipients (
  operation_id BIGINT UNSIGNED NOT NULL,
  ordinal_value INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  display_name_snapshot VARCHAR(191) NOT NULL,
  role_code_snapshot VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contribution_snapshot BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,ordinal_value),
  UNIQUE KEY uq_guild_resource_distribution_recipient (operation_id,player_id),
  CONSTRAINT fk_guild_resource_distribution_recipient_operation FOREIGN KEY (operation_id) REFERENCES guild_resource_distribution_runs(operation_id),
  CONSTRAINT fk_guild_resource_distribution_recipient_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_resource_distribution_grants (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  resource_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  storage_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  amount BIGINT UNSIGNED NOT NULL,
  balance_before BIGINT UNSIGNED NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,sequence_no),
  KEY idx_guild_resource_distribution_grant_player (player_id,resource_code),
  CONSTRAINT fk_guild_resource_distribution_grant_operation FOREIGN KEY (operation_id) REFERENCES guild_resource_distribution_runs(operation_id),
  CONSTRAINT fk_guild_resource_distribution_grant_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_resource_distribution_grant_item FOREIGN KEY (item_id) REFERENCES item_definitions(id),
  CONSTRAINT chk_guild_resource_distribution_storage CHECK (storage_kind IN ('currency','item')),
  CONSTRAINT chk_guild_resource_distribution_item CHECK ((storage_kind='item' AND item_id IS NOT NULL) OR (storage_kind='currency' AND item_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('guild_resource_distribution_ticket','길드자원분배🫂(/길드분배)','ITEM',TRUE,JSON_OBJECT('domain','guild','command','/길드분배','legacyKey','길드자원분배🫂(/길드분배)'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='ITEM',stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_RESOURCE_DISTRIBUTE','guild_resource_distribute','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드분배','GUILD_RESOURCE_DISTRIBUTE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
