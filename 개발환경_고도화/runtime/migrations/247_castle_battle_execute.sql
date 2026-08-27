START TRANSACTION;

CREATE TABLE IF NOT EXISTS castle_battle_rank_definitions (
  rank_order INT UNSIGNED NOT NULL,
  score_requirement BIGINT NOT NULL,
  tier_point INT UNSIGNED NOT NULL,
  rank_name VARCHAR(191) NOT NULL,
  PRIMARY KEY (rank_order),
  UNIQUE KEY uq_castle_battle_rank_score (score_requirement),
  UNIQUE KEY uq_castle_battle_rank_tier (tier_point)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS castle_battle_player_states (
  season_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  score BIGINT NOT NULL DEFAULT 0,
  win_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  loss_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tier_point INT UNSIGNED NOT NULL DEFAULT 1,
  last_battle_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (season_id, player_id),
  KEY idx_castle_battle_state_match (season_id, tier_point, player_id),
  CONSTRAINT fk_castle_battle_state_season FOREIGN KEY (season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_state_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS castle_battle_settlements (
  operation_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  attacker_player_id BIGINT UNSIGNED NOT NULL,
  defender_player_id BIGINT UNSIGNED NOT NULL,
  attacker_won BOOLEAN NOT NULL,
  attacker_score_before BIGINT NOT NULL,
  attacker_score_after BIGINT NOT NULL,
  defender_score_before BIGINT NOT NULL,
  defender_score_after BIGINT NOT NULL,
  winner_score_delta INT UNSIGNED NOT NULL,
  loser_score_delta INT UNSIGNED NOT NULL,
  experience_delta INT UNSIGNED NOT NULL,
  point_delta BIGINT NOT NULL,
  reset_ticket_delta INT NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_castle_battle_settlement_season (season_id, created_at),
  CONSTRAINT fk_castle_battle_settlement_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_settlement_season FOREIGN KEY (season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_settlement_attacker FOREIGN KEY (attacker_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_settlement_defender FOREIGN KEY (defender_player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO castle_battle_rank_definitions(rank_order,score_requirement,tier_point,rank_name) VALUES
  (1,0,1,'👻루키♦️'),(2,30,2,'👻루키♥️'),(3,60,3,'👻루키♠️'),
  (4,100,4,'🔥에이스♦️'),(5,150,5,'🔥에이스♥️'),(6,200,6,'🔥에이스♠️'),
  (7,300,7,'💠루비♦️'),(8,500,8,'💠루비♥️'),(9,700,9,'💠루비♠️'),
  (10,800,10,'👑크라운♦️'),(11,1000,11,'👑크라운♥️'),(12,1200,12,'👑크라운♠️'),
  (13,1600,13,'💎다이아♦️'),(14,2000,14,'💎다이아♥️'),(15,2500,15,'💎다이아♠️'),
  (16,3000,16,'🔮마스터♦️'),(17,3500,17,'🔮마스터♥️'),(18,4000,18,'🔮마스터♠️'),
  (19,5000,19,'🪽엠퍼러♦️'),(20,6000,20,'🪽엠퍼러♥️'),(21,7000,21,'🪽엠퍼러♠️'),
  (22,8000,22,'🪬올마이티♦️'),(23,9000,23,'🪬올마이티♥️'),(24,10000,24,'🪬올마이티♠️')
ON DUPLICATE KEY UPDATE score_requirement=VALUES(score_requirement),tier_point=VALUES(tier_point),rank_name=VALUES(rank_name);

INSERT INTO castle_battle_seasons(season_key,status,starts_at,ends_at,version)
SELECT 'legacy-castle-daily-v2','active',UTC_TIMESTAMP(3),NULL,1
WHERE NOT EXISTS (SELECT 1 FROM castle_battle_seasons WHERE status='active');

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('CASTLE_BATTLE_EXECUTE','castle_battle_execute','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/캐슬대전','CASTLE_BATTLE_EXECUTE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
