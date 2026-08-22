CREATE TABLE guild_territory_reward_rule_versions (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_version BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
  effective_from DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (territory_scope_code, rule_version),
  KEY idx_guild_territory_rule_status (territory_scope_code, status, effective_from),
  CONSTRAINT chk_guild_territory_rule_status CHECK (status IN ('draft', 'published', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_reward_rule_tiers (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_version BIGINT UNSIGNED NOT NULL,
  rank_from INT UNSIGNED NOT NULL,
  rank_to INT UNSIGNED NOT NULL,
  reward_json JSON NOT NULL,
  guide_text TEXT NOT NULL,
  PRIMARY KEY (territory_scope_code, rule_version, rank_from),
  UNIQUE KEY uq_guild_territory_rule_rank_to (territory_scope_code, rule_version, rank_to),
  CONSTRAINT fk_guild_territory_rule_tier_version FOREIGN KEY (territory_scope_code, rule_version)
    REFERENCES guild_territory_reward_rule_versions (territory_scope_code, rule_version) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_rule_rank_range CHECK (rank_from >= 1 AND rank_to >= rank_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_seasons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_snapshot_version BIGINT UNSIGNED NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_territory_season_key (territory_scope_code, season_key),
  KEY idx_guild_territory_season_projection (territory_scope_code, state_code, starts_at, id),
  CONSTRAINT chk_guild_territory_season_state CHECK (state_code IN ('active', 'pending', 'closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_ranking_snapshots (
  season_id BIGINT UNSIGNED NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  rule_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_version BIGINT UNSIGNED NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (season_id, snapshot_version),
  KEY idx_guild_territory_snapshot_rule (rule_scope_code, rule_version),
  CONSTRAINT fk_guild_territory_snapshot_season FOREIGN KEY (season_id)
    REFERENCES guild_territory_seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_snapshot_rule FOREIGN KEY (rule_scope_code, rule_version)
    REFERENCES guild_territory_reward_rule_versions (territory_scope_code, rule_version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_turn_order_entries (
  season_id BIGINT UNSIGNED NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  turn_state_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  scheduled_at DATETIME(3) NULL,
  PRIMARY KEY (season_id, snapshot_version, ordinal),
  UNIQUE KEY uq_guild_territory_turn_guild (season_id, snapshot_version, guild_id),
  KEY idx_guild_territory_turn_guild (guild_id),
  CONSTRAINT fk_guild_territory_turn_snapshot FOREIGN KEY (season_id, snapshot_version)
    REFERENCES guild_territory_ranking_snapshots (season_id, snapshot_version) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_turn_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_turn_ordinal CHECK (ordinal >= 1),
  CONSTRAINT chk_guild_territory_turn_state CHECK (turn_state_code IN ('active', 'pending', 'completed', 'skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_ranking_entries (
  season_id BIGINT UNSIGNED NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  score BIGINT NOT NULL,
  last_scored_at DATETIME(3) NOT NULL,
  PRIMARY KEY (season_id, snapshot_version, guild_id),
  UNIQUE KEY uq_guild_territory_ranking_ordinal (season_id, snapshot_version, ordinal),
  KEY idx_guild_territory_ranking_order (season_id, snapshot_version, score, last_scored_at, guild_id),
  CONSTRAINT fk_guild_territory_ranking_snapshot FOREIGN KEY (season_id, snapshot_version)
    REFERENCES guild_territory_ranking_snapshots (season_id, snapshot_version) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_ranking_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_ranking_ordinal CHECK (ordinal >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_remember_preferences (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_player_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  desired_state BOOLEAN NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (territory_scope_code, operator_player_id, player_id),
  KEY idx_guild_territory_remember_player (player_id, territory_scope_code),
  CONSTRAINT fk_guild_territory_remember_operator FOREIGN KEY (operator_player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_remember_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE guild_territory_seasons
  ADD CONSTRAINT fk_guild_territory_published_snapshot FOREIGN KEY (id, published_snapshot_version)
    REFERENCES guild_territory_ranking_snapshots (season_id, snapshot_version) ON DELETE RESTRICT;

-- Read-model queries must load season, snapshot, turn order, ranking, rules and preference in one DB transaction.
-- Remember preference upserts use one independent transaction. Ranking reads never own payout mutation.
