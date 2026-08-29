ALTER TABLE guild_members
  ADD COLUMN IF NOT EXISTS territory_booster_contribution BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version BIGINT UNSIGNED NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS guild_territory_booster_contribution_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  inventory_before BIGINT UNSIGNED NOT NULL,
  inventory_after BIGINT UNSIGNED NOT NULL,
  guild_booster_before BIGINT UNSIGNED NOT NULL,
  guild_booster_after BIGINT UNSIGNED NOT NULL,
  member_contribution_before BIGINT UNSIGNED NOT NULL,
  member_contribution_after BIGINT UNSIGNED NOT NULL,
  daily_count_before BIGINT UNSIGNED NOT NULL,
  daily_count_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_guild_booster_contribution_event (event_key),
  CONSTRAINT fk_guild_booster_contribution_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_booster_contribution_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_booster_contribution_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT fk_guild_booster_contribution_item FOREIGN KEY (item_id) REFERENCES item_definitions(id),
  CONSTRAINT chk_guild_booster_contribution_requested CHECK (requested_count>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_territory_booster_ledger (
  operation_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  quantity_delta BIGINT NOT NULL,
  guild_balance_after BIGINT UNSIGNED NOT NULL,
  member_contribution_after BIGINT UNSIGNED NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_guild_booster_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_booster_ledger_member FOREIGN KEY (guild_id,player_id) REFERENCES guild_members(guild_id,player_id),
  CONSTRAINT chk_guild_booster_ledger_positive CHECK (quantity_delta>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES(
  'ITEM-GUILD-TERRITORY-BOOSTER',
  '길드영지 부스터🔮(/길드부스터공헌 숫자)',
  'ITEM',
  TRUE,
  JSON_OBJECT('domain','guild_territory','command','/길드부스터공헌','legacyKey','길드영지 부스터🔮(/길드부스터공헌 숫자)'),
  TRUE,
  1
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  asset_type_code=VALUES(asset_type_code),
  stackable=TRUE,
  metadata_json=VALUES(metadata_json),
  active=TRUE,
  version=version+1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_TERRITORY_BOOSTER_CONTRIBUTE','guild_territory_booster_contribute','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE
  handler_key=VALUES(handler_key),
  auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),
  enabled=TRUE,
  version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드부스터공헌','GUILD_TERRITORY_BOOSTER_CONTRIBUTE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
