START TRANSACTION;

CREATE TABLE guild_territory_attack_item_candidates (
  guild_territory_attack_item_candidate_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_scope_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  candidate_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  priority_order INT UNSIGNED NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  success_bps INT UNSIGNED NOT NULL,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  source_locator VARCHAR(255) NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (guild_territory_attack_item_candidate_id),
  UNIQUE KEY uq_guild_territory_attack_item_candidate_priority (policy_scope_code, policy_version, candidate_role, priority_order),
  UNIQUE KEY uq_guild_territory_attack_item_candidate (policy_scope_code, policy_version, candidate_role, item_id),
  CONSTRAINT fk_guild_territory_attack_item_candidate_policy
    FOREIGN KEY (policy_scope_code, policy_version)
    REFERENCES guild_territory_attack_policy_versions(policy_scope_code, policy_version)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guild_territory_attack_item_candidate_item
    FOREIGN KEY (item_id) REFERENCES canonical_item_definitions(item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_territory_attack_item_candidate_role CHECK (candidate_role IN ('DEFENSE','ATTACK')),
  CONSTRAINT chk_guild_territory_attack_item_candidate_id CHECK (guild_territory_attack_item_candidate_id REGEXP '^[a-z][a-z0-9]{7}$'),
  CONSTRAINT chk_guild_territory_attack_item_candidate_priority CHECK (priority_order BETWEEN 1 AND 2),
  CONSTRAINT chk_guild_territory_attack_item_candidate_bps CHECK (success_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_guild_territory_attack_item_candidate_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_guild_territory_attack_item_candidate_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
