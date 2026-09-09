START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES(
  'ITEM-GUILD-MARK-CHANGE-TICKET',
  '길드마크변경권🔖(/길드마크변경 이모지)',
  'inventory_item',
  TRUE,
  JSON_OBJECT('legacySource','data/itemList.json','consumerCommand','/길드마크변경'),
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

CREATE TABLE IF NOT EXISTS guild_mark_mutation_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  actor_player_id BIGINT UNSIGNED NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  old_mark VARCHAR(191) NULL,
  new_mark VARCHAR(191) NOT NULL,
  ticket_quantity_before BIGINT UNSIGNED NOT NULL,
  ticket_quantity_after BIGINT UNSIGNED NOT NULL,
  guild_version_before BIGINT UNSIGNED NOT NULL,
  guild_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_guild_mark_mutation_guild_created (guild_id,created_at),
  CONSTRAINT fk_guild_mark_mutation_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_mark_mutation_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_mark_mutation_actor FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_mark_mutation_ticket FOREIGN KEY (ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_MARK_MUTATE','guild_mark_mutate','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드마크변경','GUILD_MARK_MUTATE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
