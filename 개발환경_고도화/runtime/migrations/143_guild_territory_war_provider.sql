CREATE TABLE guild_territory_wars (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  war_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  turn_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  instability_adjust DECIMAL(10,3) NOT NULL DEFAULT 0,
  rift_bias DECIMAL(10,3) NOT NULL DEFAULT 0,
  rift_event_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  rift_event_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rift_event_history_json JSON NOT NULL,
  rift_event_at DATETIME(3) NULL,
  rift_event_guild_id BIGINT UNSIGNED NULL,
  castle_lord_player_id BIGINT UNSIGNED NULL,
  castle_earnings DECIMAL(30,3) NOT NULL DEFAULT 0,
  castle_defense_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_territory_wars_key (war_key),
  CONSTRAINT fk_guild_territory_wars_event_guild FOREIGN KEY (rift_event_guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_wars_lord FOREIGN KEY (castle_lord_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_ready_guilds (
  war_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  ready BOOLEAN NOT NULL DEFAULT TRUE,
  eliminated_reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  eliminated_at DATETIME(3) NULL,
  PRIMARY KEY (war_id,guild_id),
  CONSTRAINT fk_guild_territory_ready_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_ready_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_occupations (
  war_id BIGINT UNSIGNED NOT NULL,
  territory_no BIGINT UNSIGNED NOT NULL,
  territory_name VARCHAR(191) NOT NULL,
  owner_guild_id BIGINT UNSIGNED NULL,
  owner_player_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (war_id,territory_no),
  CONSTRAINT fk_guild_territory_occupation_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_occupation_guild FOREIGN KEY (owner_guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_occupation_player FOREIGN KEY (owner_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_rift_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_guild_id BIGINT UNSIGNED NULL,
  event_count_after BIGINT UNSIGNED NOT NULL,
  state_before_json JSON NOT NULL,
  state_after_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_territory_rift_operation (operation_id),
  CONSTRAINT fk_guild_territory_rift_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_rift_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_rift_target FOREIGN KEY (target_guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
