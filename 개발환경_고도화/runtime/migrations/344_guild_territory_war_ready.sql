ALTER TABLE guild_territory_ready_guilds
  ADD COLUMN prepared_by_player_id BIGINT UNSIGNED NULL AFTER ready,
  ADD COLUMN prepared_by_display_name VARCHAR(191) NULL AFTER prepared_by_player_id,
  ADD COLUMN prepared_at DATETIME(3) NULL AFTER prepared_by_display_name,
  ADD COLUMN prepare_source_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual' AFTER prepared_at,
  ADD COLUMN prepare_operation_id BIGINT UNSIGNED NULL AFTER prepare_source_code,
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER prepare_operation_id,
  ADD KEY ix_guild_territory_ready_prepared_by (prepared_by_player_id),
  ADD KEY ix_guild_territory_ready_operation (prepare_operation_id),
  ADD CONSTRAINT fk_guild_territory_ready_prepared_by FOREIGN KEY (prepared_by_player_id) REFERENCES players(id),
  ADD CONSTRAINT fk_guild_territory_ready_operation FOREIGN KEY (prepare_operation_id) REFERENCES operations(id),
  ADD CONSTRAINT chk_guild_territory_ready_source CHECK (prepare_source_code IN ('manual','automatic','migration'));

CREATE TABLE guild_territory_ready_history (
  operation_id BIGINT UNSIGNED NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_ready BOOLEAN NOT NULL,
  ready BOOLEAN NOT NULL,
  prepared_at DATETIME(3) NOT NULL,
  PRIMARY KEY (operation_id),
  KEY ix_guild_territory_ready_history_scope (war_id,guild_id,prepared_at),
  CONSTRAINT fk_guild_territory_ready_history_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_territory_ready_history_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_ready_history_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT fk_guild_territory_ready_history_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT chk_guild_territory_ready_history_source CHECK (source_code IN ('manual','automatic'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_TERRITORY_WAR_READY','guild.territory.war.ready','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;
