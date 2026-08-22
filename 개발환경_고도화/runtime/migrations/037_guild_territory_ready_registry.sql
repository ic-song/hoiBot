CREATE TABLE guild_territory_ready_snapshots (
  season_id BIGINT UNSIGNED NOT NULL,
  start_snapshot_version BIGINT UNSIGNED NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (season_id, start_snapshot_version),
  CONSTRAINT fk_guild_territory_ready_snapshot_season FOREIGN KEY (season_id)
    REFERENCES guild_territory_seasons (id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_ready_snapshot_version CHECK (start_snapshot_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_ready_entries (
  season_id BIGINT UNSIGNED NOT NULL,
  start_snapshot_version BIGINT UNSIGNED NOT NULL,
  insertion_ordinal INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  stored_guild_name VARCHAR(191) NOT NULL,
  eligible BOOLEAN NOT NULL DEFAULT TRUE,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  prepared_by_player_id BIGINT UNSIGNED NULL,
  prepared_by_display_name VARCHAR(191) NULL,
  prepared_at DATETIME(3) NULL,
  PRIMARY KEY (season_id, start_snapshot_version, insertion_ordinal),
  UNIQUE KEY uq_guild_territory_ready_guild (season_id, start_snapshot_version, guild_id),
  KEY idx_guild_territory_ready_prepared_by (prepared_by_player_id),
  CONSTRAINT fk_guild_territory_ready_snapshot FOREIGN KEY (season_id, start_snapshot_version)
    REFERENCES guild_territory_ready_snapshots (season_id, start_snapshot_version) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_ready_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_ready_prepared_by FOREIGN KEY (prepared_by_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_ready_ordinal CHECK (insertion_ordinal >= 1),
  CONSTRAINT chk_guild_territory_ready_state CHECK (ready = FALSE OR eligible = TRUE),
  CONSTRAINT chk_guild_territory_ready_prepared CHECK (
    ready = FALSE OR (prepared_by_display_name IS NOT NULL AND prepared_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A snapshot row with no entries is an explicit empty registry; insertion_ordinal is stable within that immutable version.
