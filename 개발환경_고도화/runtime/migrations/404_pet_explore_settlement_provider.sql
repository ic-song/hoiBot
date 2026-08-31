START TRANSACTION;

CREATE TABLE pet_explore_settlement_policy_gaps (
  gap_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_source_value VARCHAR(64) NULL,
  canonical_policy_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reason_text VARCHAR(500) NOT NULL,
  PRIMARY KEY (gap_code),
  CONSTRAINT chk_pet_explore_settlement_gap_status CHECK (status_code IN ('RED','RESOLVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_explore_settlement_policy_gaps
  (gap_code,status_code,legacy_source_value,canonical_policy_version,reason_text)
VALUES
  ('premium_explore_bonus','RED','7_percent',NULL,'legacy source value exists but no canonical DB policy identity/version is proven')
ON DUPLICATE KEY UPDATE gap_code=VALUES(gap_code);

CREATE TABLE pet_explore_settlements (
  operation_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_round_version BIGINT UNSIGNED NOT NULL,
  resulting_round_version BIGINT UNSIGNED NOT NULL,
  participant_count INT UNSIGNED NOT NULL,
  success_count INT UNSIGNED NOT NULL,
  failure_count INT UNSIGNED NOT NULL,
  ineligible_count INT UNSIGNED NOT NULL,
  next_auto_result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_pet_explore_settlement_round (round_id),
  CONSTRAINT fk_pet_explore_settlement_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_settlement_round FOREIGN KEY (round_id) REFERENCES pet_explore_rounds(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_settlement_source CHECK (source_code IN ('manual','scheduler')),
  CONSTRAINT chk_pet_explore_settlement_status CHECK (status_code IN ('settled','noop')),
  CONSTRAINT chk_pet_explore_settlement_version CHECK (resulting_round_version = previous_round_version + 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_results (
  operation_id BIGINT UNSIGNED NOT NULL,
  result_sequence INT UNSIGNED NOT NULL,
  participation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  requested_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticket_item_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ticket_consumed BOOLEAN NOT NULL,
  fallback_applied BOOLEAN NOT NULL,
  success_threshold_basis_points INT UNSIGNED NOT NULL,
  success_roll_basis_points INT UNSIGNED NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  resulting_version BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,result_sequence),
  UNIQUE KEY uq_pet_explore_settlement_participation (participation_id),
  CONSTRAINT fk_pet_explore_settlement_result_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_settlement_result_participation FOREIGN KEY (participation_id) REFERENCES pet_explore_participations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_settlement_result_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_settlement_result_code CHECK (result_code IN ('success','failure','ineligible')),
  CONSTRAINT chk_pet_explore_settlement_result_threshold CHECK (success_threshold_basis_points <= 10000),
  CONSTRAINT chk_pet_explore_settlement_result_roll CHECK (success_roll_basis_points IS NULL OR success_roll_basis_points < 10000),
  CONSTRAINT chk_pet_explore_settlement_result_version CHECK (resulting_version = previous_version + 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_rng_evidence (
  operation_id BIGINT UNSIGNED NOT NULL,
  rng_sequence INT UNSIGNED NOT NULL,
  participation_id BIGINT UNSIGNED NOT NULL,
  stage_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sample_basis_points INT UNSIGNED NOT NULL,
  seed_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (operation_id,rng_sequence),
  CONSTRAINT fk_pet_explore_settlement_rng_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_settlement_rng_participation FOREIGN KEY (participation_id) REFERENCES pet_explore_participations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_settlement_rng_stage CHECK (stage_code IN ('fallback','success')),
  CONSTRAINT chk_pet_explore_settlement_rng_sample CHECK (sample_basis_points < 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_reward_results (
  operation_id BIGINT UNSIGNED NOT NULL,
  result_sequence INT UNSIGNED NOT NULL,
  reward_sequence INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  item_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,result_sequence,reward_sequence),
  CONSTRAINT fk_pet_explore_settlement_reward_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_settlement_reward_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_settlement_reward_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_player_records (
  player_id BIGINT UNSIGNED NOT NULL,
  attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  wins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  losses BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_operation_id BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_pet_explore_record_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_record_operation FOREIGN KEY (updated_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_record_total CHECK (attempts = wins + losses)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
