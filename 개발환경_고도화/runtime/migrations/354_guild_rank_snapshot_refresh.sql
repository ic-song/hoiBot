START TRANSACTION;

CREATE TABLE IF NOT EXISTS guild_rank_snapshot_policies (
  policy_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  title_definition_version BIGINT UNSIGNED NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  source_formula_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY(policy_key),
  UNIQUE KEY uq_guild_rank_snapshot_policy_version(policy_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_title_definitions (
  definition_version BIGINT UNSIGNED NOT NULL,
  title_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  minimum_rank INT UNSIGNED NOT NULL,
  maximum_rank INT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(definition_version,title_code),
  UNIQUE KEY uq_guild_rank_title_range(definition_version,minimum_rank),
  CONSTRAINT ck_guild_rank_title_minimum CHECK(minimum_rank>=1),
  CONSTRAINT ck_guild_rank_title_range CHECK(maximum_rank IS NULL OR maximum_rank>=minimum_rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  title_definition_version BIGINT UNSIGNED NOT NULL,
  snapshot_version BIGINT UNSIGNED NOT NULL,
  input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  eligible_guild_count INT UNSIGNED NOT NULL,
  eligible_member_count INT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uq_guild_rank_snapshot_operation(operation_id),
  UNIQUE KEY uq_guild_rank_snapshot_version(snapshot_version),
  CONSTRAINT fk_guild_rank_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_snapshot_inputs (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_charm BIGINT UNSIGNED NOT NULL,
  player_level BIGINT UNSIGNED NOT NULL,
  component_json LONGTEXT NOT NULL,
  PRIMARY KEY(snapshot_id,player_id),
  KEY ix_guild_rank_input_guild(snapshot_id,guild_id),
  CONSTRAINT fk_guild_rank_input_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_input_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_input_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_snapshot_rows (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  ordinal_value INT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  guild_name_snapshot VARCHAR(191) NOT NULL,
  guild_level BIGINT UNSIGNED NOT NULL,
  member_count INT UNSIGNED NOT NULL,
  total_charm BIGINT UNSIGNED NOT NULL,
  title_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_display_name VARCHAR(191) NOT NULL,
  PRIMARY KEY(snapshot_id,ordinal_value),
  UNIQUE KEY uq_guild_rank_snapshot_guild(snapshot_id,guild_id),
  CONSTRAINT fk_guild_rank_row_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_row_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_snapshot_current (
  policy_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY(policy_key),
  CONSTRAINT fk_guild_rank_current_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_current_projections (
  guild_id BIGINT UNSIGNED NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  ordinal_value INT UNSIGNED NOT NULL,
  total_charm BIGINT UNSIGNED NOT NULL,
  title_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_display_name VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY(guild_id),
  KEY ix_guild_rank_projection_snapshot(snapshot_id,ordinal_value),
  CONSTRAINT fk_guild_rank_projection_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_projection_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_rank_snapshot_refresh_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  actor_identity_id BIGINT UNSIGNED NOT NULL,
  outbox_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  UNIQUE KEY uq_guild_rank_refresh_snapshot(snapshot_id),
  CONSTRAINT fk_guild_rank_refresh_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_refresh_snapshot FOREIGN KEY(snapshot_id) REFERENCES guild_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_refresh_identity FOREIGN KEY(actor_identity_id) REFERENCES external_identities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_rank_refresh_outbox FOREIGN KEY(outbox_id) REFERENCES outbox_messages(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO guild_rank_snapshot_policies(policy_key,policy_version,title_definition_version,enabled,source_formula_code)
VALUES('default',1,NULL,FALSE,'PLAYER_OVERALL_CHARM_V1')
ON DUPLICATE KEY UPDATE policy_key=VALUES(policy_key);

INSERT IGNORE INTO guild_rank_snapshot_current(policy_key,snapshot_id,version)
VALUES('default',NULL,0);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('GUILD_RANK_SNAPSHOT_REFRESH','guild.rank.snapshot.refresh','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/길드순위','GUILD_RANK_SNAPSHOT_REFRESH',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
