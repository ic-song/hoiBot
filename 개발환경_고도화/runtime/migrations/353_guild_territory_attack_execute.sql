ALTER TABLE guild_territory_occupations
  ADD COLUMN occupied_at DATETIME(3) NULL AFTER owner_player_id;

ALTER TABLE guild_territory_turns
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER turn_state;

CREATE TABLE guild_territory_attack_policy_versions (
  policy_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  personal_attack_limit INT UNSIGNED NOT NULL,
  max_owned_territories INT UNSIGNED NOT NULL,
  wrong_turn_penalty INT UNSIGNED NOT NULL,
  dimension_eliminate_bps INT UNSIGNED NOT NULL,
  dimension_player_penalty INT UNSIGNED NOT NULL,
  dimension_attack_penalty INT UNSIGNED NOT NULL,
  remember_success_bps INT UNSIGNED NOT NULL,
  turn_fund BIGINT UNSIGNED NOT NULL,
  max_owned_fund_multiplier INT UNSIGNED NOT NULL,
  defense_ticket_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  defense_ticket_bps INT UNSIGNED NOT NULL,
  attack_ticket_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attack_ticket_bps INT UNSIGNED NOT NULL,
  contribution_medal_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contribution_medal_bps INT UNSIGNED NULL,
  contribution_medal_quantity BIGINT UNSIGNED NULL,
  evidence_label VARCHAR(255) NULL,
  rift_event_base_bps INT UNSIGNED NULL,
  instability_bps_per_point INT UNSIGNED NULL,
  normal_rift_base_bps INT UNSIGNED NULL,
  rift_bias_bps_per_point INT UNSIGNED NULL,
  rift_evidence_label VARCHAR(255) NULL,
  activated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (policy_scope_code, policy_version),
  CONSTRAINT chk_guild_territory_attack_policy_status CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  CONSTRAINT chk_guild_territory_attack_policy_bps CHECK (
    dimension_eliminate_bps <= 10000 AND remember_success_bps <= 10000 AND
    defense_ticket_bps <= 10000 AND attack_ticket_bps <= 10000 AND
    (contribution_medal_bps IS NULL OR contribution_medal_bps <= 10000) AND
    (rift_event_base_bps IS NULL OR rift_event_base_bps <= 10000) AND
    (normal_rift_base_bps IS NULL OR normal_rift_base_bps <= 10000)
  ),
  CONSTRAINT chk_guild_territory_attack_active_policy_complete CHECK (
    status <> 'ACTIVE' OR (
      contribution_medal_bps IS NOT NULL AND contribution_medal_quantity IS NOT NULL AND
      contribution_medal_quantity > 0 AND evidence_label IS NOT NULL AND
      rift_event_base_bps IS NOT NULL AND instability_bps_per_point IS NOT NULL AND
      normal_rift_base_bps IS NOT NULL AND rift_bias_bps_per_point IS NOT NULL AND rift_evidence_label IS NOT NULL
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_attack_feature_controls (
  control_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  remember_event_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (control_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_guild_attack_states (
  war_id BIGINT UNSIGNED NOT NULL,
  generation_version BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  eliminated BOOLEAN NOT NULL DEFAULT FALSE,
  elimination_reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (war_id, generation_version, guild_id),
  CONSTRAINT fk_guild_territory_attack_guild_state_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_attack_guild_state_guild FOREIGN KEY (guild_id) REFERENCES guilds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_player_attack_states (
  war_id BIGINT UNSIGNED NOT NULL,
  generation_version BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  attacks_used INT UNSIGNED NOT NULL DEFAULT 0,
  dimension_penalty_turns INT UNSIGNED NOT NULL DEFAULT 0,
  eliminated BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (war_id, generation_version, player_id),
  KEY ix_guild_territory_player_attack_guild (war_id, generation_version, guild_id),
  CONSTRAINT fk_guild_territory_player_attack_state_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_player_attack_state_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_territory_player_attack_state_guild FOREIGN KEY (guild_id) REFERENCES guilds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_combat_snapshots (
  war_id BIGINT UNSIGNED NOT NULL,
  generation_version BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  castle_charm BIGINT UNSIGNED NOT NULL,
  critical_bps INT UNSIGNED NOT NULL,
  critical_multiplier_bps INT UNSIGNED NOT NULL,
  surprise_defense_bonus_bps INT UNSIGNED NOT NULL DEFAULT 0,
  pet_snapshot_json JSON NOT NULL,
  source_operation_id BIGINT UNSIGNED NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (war_id, generation_version, player_id),
  CONSTRAINT fk_guild_territory_combat_snapshot_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_combat_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_territory_combat_snapshot_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT fk_guild_territory_combat_snapshot_operation FOREIGN KEY (source_operation_id) REFERENCES operations(id),
  CONSTRAINT chk_guild_territory_combat_snapshot_bps CHECK (
    critical_bps <= 10000 AND critical_multiplier_bps >= 10000 AND surprise_defense_bonus_bps <= 10000
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_attack_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  generation_version BIGINT UNSIGNED NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  target_no INT UNSIGNED NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  war_version_before BIGINT UNSIGNED NOT NULL,
  war_version_after BIGINT UNSIGNED NOT NULL,
  result_json JSON NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_territory_attack_event (event_key),
  UNIQUE KEY uq_guild_territory_attack_operation (operation_id),
  KEY ix_guild_territory_attack_generation (war_id, generation_version, guild_id),
  CONSTRAINT fk_guild_territory_attack_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_territory_attack_run_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id),
  CONSTRAINT fk_guild_territory_attack_run_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_territory_attack_run_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT chk_guild_territory_attack_target CHECK (target_no BETWEEN 1 AND 9)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_attack_random_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  draw_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  draw_bps INT UNSIGNED NOT NULL,
  outcome_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id, sequence_no),
  UNIQUE KEY uq_guild_territory_attack_draw_code (operation_id, draw_code),
  CONSTRAINT fk_guild_territory_attack_draw_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT chk_guild_territory_attack_draw_bps CHECK (draw_bps < 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_attack_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  event_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id, event_code),
  CONSTRAINT fk_guild_territory_attack_event_operation FOREIGN KEY (operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
  ('territory_defense_ticket','영지절대방어권🛡(20%)','STACK',TRUE,JSON_OBJECT('source','legacy-command-index','usage','guild_territory_attack'),TRUE,1),
  ('territory_attack_ticket','영지기습공격권🔥(10%)','STACK',TRUE,JSON_OBJECT('source','legacy-command-index','usage','guild_territory_attack'),TRUE,1),
  ('guild_contribution_medal','길드공헌훈장🌟(/길드공헌 숫자)','STACK',TRUE,JSON_OBJECT('source','legacy-command-index','usage','guild_territory_attack'),TRUE,1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,
  metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

INSERT INTO guild_territory_attack_policy_versions (
  policy_scope_code,policy_version,status,personal_attack_limit,max_owned_territories,wrong_turn_penalty,
  dimension_eliminate_bps,dimension_player_penalty,dimension_attack_penalty,remember_success_bps,
  turn_fund,max_owned_fund_multiplier,defense_ticket_item_code,defense_ticket_bps,
  attack_ticket_item_code,attack_ticket_bps,contribution_medal_item_code,
  contribution_medal_bps,contribution_medal_quantity,evidence_label,
  rift_event_base_bps,instability_bps_per_point,normal_rift_base_bps,rift_bias_bps_per_point,rift_evidence_label
) VALUES (
  'world-attack',1,'DRAFT',10,3,5,8000,2,4,3000,50000000,2,
  'territory_defense_ticket',2000,'territory_attack_ticket',1000,'guild_contribution_medal',
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
) ON DUPLICATE KEY UPDATE
  personal_attack_limit=VALUES(personal_attack_limit),max_owned_territories=VALUES(max_owned_territories),
  wrong_turn_penalty=VALUES(wrong_turn_penalty),dimension_eliminate_bps=VALUES(dimension_eliminate_bps),
  dimension_player_penalty=VALUES(dimension_player_penalty),dimension_attack_penalty=VALUES(dimension_attack_penalty),
  remember_success_bps=VALUES(remember_success_bps),turn_fund=VALUES(turn_fund),
  max_owned_fund_multiplier=VALUES(max_owned_fund_multiplier),defense_ticket_item_code=VALUES(defense_ticket_item_code),
  defense_ticket_bps=VALUES(defense_ticket_bps),attack_ticket_item_code=VALUES(attack_ticket_item_code),
  attack_ticket_bps=VALUES(attack_ticket_bps),contribution_medal_item_code=VALUES(contribution_medal_item_code);

INSERT INTO guild_territory_attack_feature_controls(control_code,remember_event_enabled)
VALUES ('current',FALSE)
ON DUPLICATE KEY UPDATE control_code=VALUES(control_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_TERRITORY_ATTACK_EXECUTE','guild.territory.attack.execute','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/영지공격','GUILD_TERRITORY_ATTACK_EXECUTE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
