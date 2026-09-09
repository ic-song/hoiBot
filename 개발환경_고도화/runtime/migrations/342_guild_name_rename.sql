START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES(
  'ITEM-GUILD-NAME-RENAME-TICKET',
  '길드이름변경권🪧(/길드이름변경 이름)',
  'inventory_item',
  TRUE,
  JSON_OBJECT('legacySource','data/itemList.json','consumerCommand','/길드이름변경'),
  TRUE,
  1
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),
  metadata_json=VALUES(metadata_json),
  active=VALUES(active),
  version=VALUES(version);

CREATE TABLE guild_name_registry (
  guild_id BIGINT UNSIGNED NOT NULL,
  normalized_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id),
  UNIQUE KEY uq_guild_name_registry_normalized (normalized_name),
  CONSTRAINT fk_guild_name_registry_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO guild_name_registry(guild_id,normalized_name,display_name,version)
SELECT id,TRIM(display_name),display_name,1
FROM guilds
WHERE status='active'
ORDER BY id;

CREATE TABLE guild_name_rename_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  old_display_name VARCHAR(191) NOT NULL,
  new_display_name VARCHAR(191) NOT NULL,
  old_normalized_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  new_normalized_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ticket_quantity_before BIGINT UNSIGNED NOT NULL,
  ticket_quantity_after BIGINT UNSIGNED NOT NULL,
  guild_version_before BIGINT UNSIGNED NOT NULL,
  guild_version_after BIGINT UNSIGNED NOT NULL,
  registry_version_before BIGINT UNSIGNED NOT NULL,
  registry_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_guild_name_rename_guild_created (guild_id,created_at),
  CONSTRAINT fk_guild_name_rename_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_name_rename_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_name_rename_actor FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_name_rename_ticket FOREIGN KEY (ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_NAME_RENAME','guild_name_rename','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드이름변경','GUILD_NAME_RENAME',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
