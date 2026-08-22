CREATE TABLE guild_territory_status_aggregates (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id BIGINT UNSIGNED NULL,
  event_active BOOLEAN NOT NULL DEFAULT FALSE,
  season_active BOOLEAN NOT NULL DEFAULT FALSE,
  dimension_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  remember_me_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (territory_scope_code),
  KEY idx_guild_territory_status_season (season_id),
  CONSTRAINT fk_guild_territory_status_season FOREIGN KEY (season_id) REFERENCES guild_territory_seasons (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_status_slots (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_no TINYINT UNSIGNED NOT NULL,
  owner_guild_id BIGINT UNSIGNED NULL,
  stored_owner_guild_name VARCHAR(191) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (territory_scope_code, slot_no),
  KEY idx_guild_territory_status_owner (owner_guild_id),
  CONSTRAINT fk_guild_territory_status_slot_aggregate FOREIGN KEY (territory_scope_code)
    REFERENCES guild_territory_status_aggregates (territory_scope_code) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_status_owner FOREIGN KEY (owner_guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_status_slot CHECK (slot_no BETWEEN 1 AND 7),
  CONSTRAINT chk_guild_territory_status_owner_name CHECK (owner_guild_id IS NULL OR stored_owner_guild_name IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_status_repairs (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expected_version BIGINT UNSIGNED NOT NULL,
  result_version BIGINT UNSIGNED NOT NULL,
  repair_delta_json JSON NOT NULL,
  result_delta_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (territory_scope_code, idempotency_key),
  CONSTRAINT fk_guild_territory_status_repair_aggregate FOREIGN KEY (territory_scope_code)
    REFERENCES guild_territory_status_aggregates (territory_scope_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Legacy import writes are explicit repairs; reads never mutate defaults, slots, flags or versions.
