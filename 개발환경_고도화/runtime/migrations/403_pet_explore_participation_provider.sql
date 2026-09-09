START TRANSACTION;

ALTER TABLE pet_explore_participations
  ADD KEY idx_pet_explore_participation_player_current (player_id, state_code, round_id),
  ADD CONSTRAINT chk_pet_explore_participation_semantic_destination
    CHECK (destination_code NOT REGEXP '^[0-9]+$');

CREATE TABLE pet_explore_participation_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  participation_id BIGINT UNSIGNED NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  participation_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  detail_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  requested_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resulting_destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  previous_version BIGINT UNSIGNED NULL,
  resulting_version BIGINT UNSIGNED NULL,
  checked_ticket_name VARCHAR(191) NULL,
  checked_ticket_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_pet_explore_participation_change_player (round_id, player_id, created_at),
  KEY idx_pet_explore_participation_change_target (participation_id, created_at),
  CONSTRAINT fk_pet_explore_participation_change_operation
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_participation_change_participation
    FOREIGN KEY (participation_id) REFERENCES pet_explore_participations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_participation_change_round
    FOREIGN KEY (round_id) REFERENCES pet_explore_rounds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_participation_change_player
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_participation_change_mode
    CHECK (participation_mode IN ('manual','auto')),
  CONSTRAINT chk_pet_explore_participation_change_result
    CHECK (result_code IN ('created','changed','noop')),
  CONSTRAINT chk_pet_explore_participation_change_detail
    CHECK (detail_code IN ('created','manual_changed','same_destination','auto_existing','ticket_unavailable')),
  CONSTRAINT chk_pet_explore_participation_change_versions
    CHECK (
      (result_code = 'created' AND previous_version IS NULL AND resulting_version = 1) OR
      (result_code = 'changed' AND resulting_version = previous_version + 1) OR
      (result_code = 'noop' AND (resulting_version = previous_version OR (resulting_version IS NULL AND previous_version IS NULL)))
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
