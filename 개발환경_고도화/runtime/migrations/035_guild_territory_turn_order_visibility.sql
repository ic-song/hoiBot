ALTER TABLE guild_territory_turn_order_entries
  ADD COLUMN player_id BIGINT UNSIGNED NULL AFTER guild_id,
  ADD COLUMN user_eliminated BOOLEAN NOT NULL DEFAULT FALSE AFTER player_id,
  ADD COLUMN guild_eliminated BOOLEAN NOT NULL DEFAULT FALSE AFTER user_eliminated,
  ADD COLUMN exclusion_reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER guild_eliminated,
  ADD KEY idx_guild_territory_turn_player (player_id),
  ADD CONSTRAINT fk_guild_territory_turn_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_guild_territory_turn_exclusion_reason CHECK (
    (user_eliminated = FALSE AND guild_eliminated = FALSE) OR exclusion_reason_code IS NOT NULL
  );

-- Null player IDs preserve pre-035 rows safely; providers mark them missing-player and never expose them as visible.
