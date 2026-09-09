INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES (
  'ITEM-GUILD-CREATE-TICKET',
  '길드생성권(/길드생성)',
  'inventory_item',
  TRUE,
  JSON_OBJECT('legacyBehavior','possession-only','consumerCommands',JSON_ARRAY('/길드생성','/길드만들기')),
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

CREATE TABLE IF NOT EXISTS guild_create_sessions (
  player_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_event_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  expires_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_guild_create_sessions_status_expiry (status,expires_at),
  CONSTRAINT fk_guild_create_session_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_creation_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  normalized_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  display_name VARCHAR(191) NULL,
  mark VARCHAR(191) NULL,
  point_before DECIMAL(30,3) NULL,
  point_after DECIMAL(30,3) NULL,
  ticket_quantity BIGINT UNSIGNED NULL,
  session_version BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_guild_creation_runs_player_created (player_id,created_at),
  KEY idx_guild_creation_runs_guild (guild_id),
  CONSTRAINT fk_guild_creation_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_creation_run_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_creation_run_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES
  ('GUILD_CREATE_START','guild_create','VERIFIED_USER','SHADOW',TRUE,1),
  ('GUILD_CREATE_COMMIT','guild_create','VERIFIED_USER','SHADOW',TRUE,1),
  ('GUILD_CREATE_CANCEL','guild_create','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE
  handler_key=VALUES(handler_key),
  auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),
  enabled=VALUES(enabled),
  version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES
  ('/길드생성','GUILD_CREATE_START',TRUE),
  ('/길드만들기','GUILD_CREATE_COMMIT',TRUE),
  ('/길드안만들꼬임','GUILD_CREATE_CANCEL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
