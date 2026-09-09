CREATE TABLE IF NOT EXISTS guild_territory_reward_rule_versions (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_version BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
  effective_from DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (territory_scope_code, rule_version),
  CONSTRAINT chk_guild_territory_finish_rule_status CHECK (status IN ('draft','published','retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_territory_reward_rule_tiers (
  territory_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_version BIGINT UNSIGNED NOT NULL,
  rank_from INT UNSIGNED NOT NULL,
  rank_to INT UNSIGNED NOT NULL,
  reward_json JSON NOT NULL,
  guide_text TEXT NOT NULL,
  PRIMARY KEY (territory_scope_code, rule_version, rank_from),
  UNIQUE KEY uq_guild_territory_finish_rule_rank_to (territory_scope_code, rule_version, rank_to),
  CONSTRAINT fk_guild_territory_finish_rule_version FOREIGN KEY (territory_scope_code, rule_version)
    REFERENCES guild_territory_reward_rule_versions (territory_scope_code, rule_version),
  CONSTRAINT chk_guild_territory_finish_rule_rank CHECK (rank_from >= 1 AND rank_to >= rank_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_finish_operator_allowlist (
  operator_id BIGINT UNSIGNED NOT NULL,
  external_channel_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_label VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operator_id, external_channel_id),
  CONSTRAINT fk_guild_territory_finish_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_score_accounts (
  guild_id BIGINT UNSIGNED NOT NULL,
  score BIGINT NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id),
  CONSTRAINT fk_guild_territory_score_guild FOREIGN KEY (guild_id) REFERENCES guilds (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_finish_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  finish_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  generation_operation_id BIGINT UNSIGNED NULL,
  trigger_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lifecycle_before VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lifecycle_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  war_version_before BIGINT UNSIGNED NOT NULL,
  war_version_after BIGINT UNSIGNED NOT NULL,
  owner_snapshot_json JSON NOT NULL,
  ranking_snapshot_json JSON NOT NULL,
  result_json JSON NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_territory_finish_key (finish_key),
  UNIQUE KEY uq_guild_territory_finish_operation (operation_id),
  UNIQUE KEY uq_guild_territory_finish_generation (war_id, generation_operation_id),
  CONSTRAINT fk_guild_territory_finish_run_operation FOREIGN KEY (operation_id) REFERENCES operations (id),
  CONSTRAINT fk_guild_territory_finish_run_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars (id),
  CONSTRAINT fk_guild_territory_finish_generation FOREIGN KEY (generation_operation_id) REFERENCES operations (id),
  CONSTRAINT chk_guild_territory_finish_trigger CHECK (trigger_code IN ('manual','auto','event'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_finish_entries (
  finish_run_id BIGINT UNSIGNED NOT NULL,
  territory_no BIGINT UNSIGNED NOT NULL,
  owner_guild_id BIGINT UNSIGNED NULL,
  owner_player_id BIGINT UNSIGNED NULL,
  reward_json JSON NOT NULL,
  reward_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (finish_run_id, territory_no),
  CONSTRAINT fk_guild_territory_finish_entry_run FOREIGN KEY (finish_run_id) REFERENCES guild_territory_finish_runs (id),
  CONSTRAINT fk_guild_territory_finish_entry_guild FOREIGN KEY (owner_guild_id) REFERENCES guilds (id),
  CONSTRAINT fk_guild_territory_finish_entry_player FOREIGN KEY (owner_player_id) REFERENCES players (id),
  CONSTRAINT chk_guild_territory_finish_reward_status CHECK (reward_status IN ('granted','unoccupied'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_finish_guild_summaries (
  finish_run_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  territory_count INT UNSIGNED NOT NULL,
  score_delta BIGINT NOT NULL DEFAULT 0,
  score_after BIGINT NOT NULL DEFAULT 0,
  booster_before BIGINT UNSIGNED NOT NULL DEFAULT 0,
  booster_after BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_after DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (finish_run_id, guild_id),
  CONSTRAINT fk_guild_territory_finish_summary_run FOREIGN KEY (finish_run_id) REFERENCES guild_territory_finish_runs (id),
  CONSTRAINT fk_guild_territory_finish_summary_guild FOREIGN KEY (guild_id) REFERENCES guilds (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_score_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  territory_no BIGINT UNSIGNED NOT NULL,
  score_delta BIGINT NOT NULL,
  score_after BIGINT NOT NULL,
  reason_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_territory_score_ledger_sequence (operation_id, sequence_no),
  CONSTRAINT fk_guild_territory_score_ledger_operation FOREIGN KEY (operation_id) REFERENCES operations (id),
  CONSTRAINT fk_guild_territory_score_ledger_guild FOREIGN KEY (guild_id) REFERENCES guilds (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO guild_territory_reward_rule_versions
  (territory_scope_code, rule_version, status, effective_from, published_at)
VALUES ('world-finish', 1, 'published', '2026-02-01 00:00:00.000', '2026-02-01 00:00:00.000')
ON DUPLICATE KEY UPDATE status=VALUES(status), effective_from=VALUES(effective_from), published_at=VALUES(published_at);

INSERT INTO guild_territory_reward_rule_tiers
  (territory_scope_code, rule_version, rank_from, rank_to, reward_json, guide_text)
VALUES
  ('world-finish',1,1,1,JSON_OBJECT('kind','tax_rate','taxRatePercent',15),'호월킹덤 세금 15%'),
  ('world-finish',1,2,2,JSON_OBJECT('kind','warehouse_item','itemCode','pet_skill_book_fragment','quantity',5),'펫스킬북 조각 5개'),
  ('world-finish',1,3,3,JSON_OBJECT('kind','warehouse_item','itemCode','ITEM-PENDANT-ENHANCE-STONE','quantity',5),'펜던트 강화석 5개'),
  ('world-finish',1,4,4,JSON_OBJECT('kind','warehouse_item','itemCode','pet_enhance_stone','quantity',200),'펫 강화석 200개'),
  ('world-finish',1,5,5,JSON_OBJECT('kind','warehouse_item','itemCode','mini_pet_enhance_stone','quantity',150),'미니펫 강화석 150개'),
  ('world-finish',1,6,6,JSON_OBJECT('kind','guild_resource','currencyCode','diamond','amount','20'),'다이아 20개'),
  ('world-finish',1,7,7,JSON_OBJECT('kind','fund_score','currencyCode','POINT','amount','2000000000','territoryScore',100),'길드창고 포인트와 영지점수')
ON DUPLICATE KEY UPDATE rank_to=VALUES(rank_to), reward_json=VALUES(reward_json), guide_text=VALUES(guide_text);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_TERRITORY_WAR_FINISH','guild.territory.finish','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key), auth_scope=VALUES(auth_scope), enabled=TRUE, version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/길드영지종료','GUILD_TERRITORY_WAR_FINISH',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code), active=TRUE;
