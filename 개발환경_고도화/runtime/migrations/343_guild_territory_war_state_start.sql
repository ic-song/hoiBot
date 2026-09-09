START TRANSACTION;

ALTER TABLE guild_territory_wars
  ADD COLUMN lifecycle_state VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'READY' AFTER active,
  ADD COLUMN start_ready BOOLEAN NOT NULL DEFAULT FALSE AFTER lifecycle_state,
  ADD COLUMN pending_start_token VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER start_ready,
  ADD COLUMN pending_start_due_at DATETIME(3) NULL AFTER pending_start_token,
  ADD COLUMN opening_token VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER pending_start_due_at,
  ADD COLUMN opening_due_at DATETIME(3) NULL AFTER opening_token,
  ADD COLUMN current_turn_no INT UNSIGNED NOT NULL DEFAULT 0 AFTER opening_due_at,
  ADD COLUMN turn_deadline_at DATETIME(3) NULL AFTER current_turn_no,
  ADD COLUMN started_at DATETIME(3) NULL AFTER turn_deadline_at,
  ADD COLUMN start_operation_id BIGINT UNSIGNED NULL AFTER started_at,
  ADD KEY ix_guild_territory_wars_lifecycle (lifecycle_state,pending_start_due_at,opening_due_at),
  ADD CONSTRAINT fk_guild_territory_wars_start_operation FOREIGN KEY (start_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_guild_territory_wars_lifecycle CHECK (lifecycle_state IN ('READY','PENDING_START','ACTIVE_OPENING','ACTIVE_READY'));

UPDATE guild_territory_wars
SET lifecycle_state=IF(active,'ACTIVE_READY','READY'),start_ready=active
WHERE lifecycle_state='READY';

CREATE TABLE guild_territory_start_scopes (
  scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (scope_code),
  UNIQUE KEY uq_guild_territory_start_scope_war (war_id),
  CONSTRAINT fk_guild_territory_start_scope_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_start_operator_allowlist (
  operator_id BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_label VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operator_id),
  CONSTRAINT fk_guild_territory_start_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_start_destinations (
  destination_id VARCHAR(191) NOT NULL,
  destination_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position_no INT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (destination_id,destination_kind),
  UNIQUE KEY uq_guild_territory_start_destination_order (destination_kind,position_no),
  CONSTRAINT chk_guild_territory_start_destination_kind CHECK (destination_kind IN ('NOTICE','CASTLE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_turns (
  war_id BIGINT UNSIGNED NOT NULL,
  generation_version BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  attacker_player_id BIGINT UNSIGNED NOT NULL,
  attack_limit INT UNSIGNED NOT NULL DEFAULT 30,
  attacks_used INT UNSIGNED NOT NULL DEFAULT 0,
  turn_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (war_id,generation_version,ordinal),
  UNIQUE KEY uq_guild_territory_turn_generation_guild (war_id,generation_version,guild_id),
  KEY ix_guild_territory_turn_attacker (attacker_player_id),
  CONSTRAINT fk_guild_territory_turn_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_territory_turn_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_turn_attacker FOREIGN KEY (attacker_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_turn_ordinal CHECK (ordinal>0),
  CONSTRAINT chk_guild_territory_turn_limit CHECK (attack_limit>0 AND attacks_used<=attack_limit),
  CONSTRAINT chk_guild_territory_turn_state CHECK (turn_state IN ('PENDING','ACTIVE','COMPLETED','SKIPPED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_turn_random_draws (
  operation_id BIGINT UNSIGNED NOT NULL,
  draw_no INT UNSIGNED NOT NULL,
  upper_bound INT UNSIGNED NOT NULL,
  sample_value DECIMAL(20,18) NOT NULL,
  selected_index INT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,draw_no),
  CONSTRAINT fk_guild_territory_turn_draw_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_turn_draw CHECK (upper_bound>0 AND selected_index<upper_bound AND sample_value>=0 AND sample_value<1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_scheduled_transitions (
  transition_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  transition_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_for DATETIME(3) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  operation_id BIGINT UNSIGNED NOT NULL,
  expected_war_version BIGINT UNSIGNED NOT NULL,
  payload_json JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (transition_key),
  UNIQUE KEY uq_guild_territory_transition_operation (operation_id,transition_code),
  KEY ix_guild_territory_transition_due (status,scheduled_for),
  CONSTRAINT fk_guild_territory_transition_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_transition_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_transition_code CHECK (transition_code IN ('START_OPENING','ENABLE_ATTACKS')),
  CONSTRAINT chk_guild_territory_transition_status CHECK (status IN ('PENDING','COMPLETED','SKIPPED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_start_runs (
  request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  generation_version BIGINT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (request_key),
  UNIQUE KEY uq_guild_territory_start_run_operation (operation_id),
  CONSTRAINT fk_guild_territory_start_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_start_run_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_start_run_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_start_run_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_TERRITORY_WAR_STATE_START','guild_territory_war_state_start','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드영지시작','GUILD_TERRITORY_WAR_STATE_START',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
