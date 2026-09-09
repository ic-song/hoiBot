ALTER TABLE guilds
  ADD COLUMN server_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER mark,
  ADD COLUMN level INT UNSIGNED NOT NULL DEFAULT 1 AFTER server_code,
  ADD COLUMN join_requirement_experience BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER level,
  ADD COLUMN member_join_closed BOOLEAN NOT NULL DEFAULT FALSE AFTER join_requirement_experience,
  ADD COLUMN max_members INT UNSIGNED NOT NULL DEFAULT 5 AFTER member_join_closed,
  ADD COLUMN recruitment_bonus INT UNSIGNED NOT NULL DEFAULT 0 AFTER max_members,
  ADD CONSTRAINT fk_guild_server_code FOREIGN KEY (server_code) REFERENCES game_servers (code) ON DELETE RESTRICT;

CREATE TABLE guild_join_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  guild_no INT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  requested_event_id VARCHAR(128) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_join_request_player (player_id),
  KEY idx_guild_join_request_status_expiry (status, expires_at),
  CONSTRAINT fk_guild_join_request_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_join_request_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_join_request_event FOREIGN KEY (requested_event_id) REFERENCES event_inbox (event_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
