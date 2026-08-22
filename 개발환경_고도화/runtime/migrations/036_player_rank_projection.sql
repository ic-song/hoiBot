CREATE TABLE player_rank_projections (
  player_id BIGINT UNSIGNED NOT NULL,
  rank_label VARCHAR(255) NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  source_updated_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  KEY idx_player_rank_projection_source (source_code, source_updated_at),
  CONSTRAINT fk_player_rank_projection_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT chk_player_rank_projection_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- rank_label stores the authoritative complete checkRank-equivalent label; consumers must not derive it from names or tier codes.
