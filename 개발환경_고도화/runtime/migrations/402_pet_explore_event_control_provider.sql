START TRANSACTION;

ALTER TABLE pet_explore_runtime_config
  ADD COLUMN updated_operation_id BIGINT UNSIGNED NULL AFTER version,
  ADD CONSTRAINT fk_pet_explore_runtime_operation
    FOREIGN KEY (updated_operation_id) REFERENCES operations(id) ON DELETE RESTRICT;

CREATE TABLE pet_explore_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_operation_id BIGINT UNSIGNED NULL,
  updated_operation_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_explore_round_key (round_key),
  CONSTRAINT fk_pet_explore_round_created_operation
    FOREIGN KEY (created_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_round_updated_operation
    FOREIGN KEY (updated_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_round_state
    CHECK (state_code IN ('open','closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_participations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  participation_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_operation_id BIGINT UNSIGNED NULL,
  updated_operation_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_explore_participation_key (participation_key),
  UNIQUE KEY uq_pet_explore_participation_round_player (round_id, player_id),
  KEY idx_pet_explore_participation_current (destination_code, state_code, round_id),
  CONSTRAINT fk_pet_explore_participation_round
    FOREIGN KEY (round_id) REFERENCES pet_explore_rounds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_participation_player
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_participation_created_operation
    FOREIGN KEY (created_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_participation_updated_operation
    FOREIGN KEY (updated_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_participation_state
    CHECK (state_code IN ('active','settled','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_event_control_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  event_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_active BOOLEAN NOT NULL,
  requested_active BOOLEAN NOT NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  resulting_version BIGINT UNSIGNED NOT NULL,
  relocated_participant_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_pet_explore_event_control_event (event_code, resulting_version),
  CONSTRAINT fk_pet_explore_event_control_operation
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_event_control_code
    CHECK (event_code IN ('diamond_mine','guild_raid')),
  CONSTRAINT chk_pet_explore_event_control_version
    CHECK (resulting_version >= previous_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_event_control_relocations (
  operation_id BIGINT UNSIGNED NOT NULL,
  participation_id BIGINT UNSIGNED NOT NULL,
  previous_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resulting_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  resulting_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id, participation_id),
  CONSTRAINT fk_pet_explore_relocation_operation
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_relocation_participation
    FOREIGN KEY (participation_id) REFERENCES pet_explore_participations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_relocation_destination
    CHECK (resulting_destination_code = 'regular_mine'),
  CONSTRAINT chk_pet_explore_relocation_version
    CHECK (resulting_version = previous_version + 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
