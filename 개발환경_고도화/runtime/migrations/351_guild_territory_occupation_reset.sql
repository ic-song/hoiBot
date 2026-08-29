START TRANSACTION;

CREATE TABLE guild_territory_occupation_reset_operator_allowlist (
  operator_id BIGINT UNSIGNED NOT NULL,
  external_channel_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_label VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operator_id,external_channel_id),
  CONSTRAINT fk_guild_territory_reset_allowlist_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_territory_occupation_reset_runs (
  request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  war_id BIGINT UNSIGNED NOT NULL,
  territory_count INT UNSIGNED NOT NULL,
  pending_transitions_skipped INT UNSIGNED NOT NULL,
  previous_war_json JSON NOT NULL,
  previous_castle_json JSON NULL,
  previous_occupations_json JSON NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (request_key),
  UNIQUE KEY uq_guild_territory_reset_operation (operation_id),
  KEY ix_guild_territory_reset_war (war_id,created_at),
  CONSTRAINT fk_guild_territory_reset_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_reset_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_reset_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_reset_count CHECK (territory_count=7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_TERRITORY_OCCUPATION_RESET','guild_territory_occupation_reset','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드영지초기화','GUILD_TERRITORY_OCCUPATION_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
