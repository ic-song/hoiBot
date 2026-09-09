ALTER TABLE player_homes ADD COLUMN IF NOT EXISTS last_heart_expression_date DATE NULL AFTER like_count;

CREATE TABLE IF NOT EXISTS pet_home_follows (
  follower_player_id BIGINT UNSIGNED NOT NULL, followed_player_id BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE, version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (follower_player_id, followed_player_id), KEY idx_pet_home_follows_followed_active (followed_player_id, active),
  CONSTRAINT fk_pet_home_follows_follower FOREIGN KEY (follower_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_home_follows_followed FOREIGN KEY (followed_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_home_follows_distinct CHECK (follower_player_id <> followed_player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_pet_home_heart_usage (
  player_id BIGINT UNSIGNED NOT NULL, usage_date DATE NOT NULL, used_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id, usage_date),
  CONSTRAINT fk_pet_home_heart_usage_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_own_heart_reads (
  operation_id BIGINT UNSIGNED NOT NULL, player_id BIGINT UNSIGNED NOT NULL, usage_date DATE NOT NULL,
  access_allowed BOOLEAN NOT NULL, base_count BIGINT UNSIGNED NOT NULL, mutual_bonus BIGINT UNSIGNED NOT NULL,
  premium_bonus BIGINT UNSIGNED NOT NULL, skill_bonus BIGINT UNSIGNED NOT NULL, used_count BIGINT UNSIGNED NOT NULL,
  remaining_count BIGINT UNSIGNED NOT NULL, limit_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (operation_id),
  KEY idx_social_own_heart_player_date (player_id, usage_date),
  CONSTRAINT fk_social_own_heart_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_social_own_heart_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('SOCIAL_OWN_HEART','social_own_heart','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/내마음','SOCIAL_OWN_HEART',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
COMMIT;
