CREATE TABLE IF NOT EXISTS skill_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skill_definition_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_skill_assignments (
  player_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  acquired_at DATETIME(3) NULL,
  PRIMARY KEY (player_id, skill_id),
  CONSTRAINT fk_player_skill_assignment_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_skill_assignment_skill FOREIGN KEY (skill_id) REFERENCES skill_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS castle_states (
  code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  lord_player_id BIGINT UNSIGNED NULL,
  tax_rate TINYINT UNSIGNED NOT NULL DEFAULT 5,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (code),
  CONSTRAINT fk_castle_state_lord FOREIGN KEY (lord_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_castle_state_tax_rate CHECK (tax_rate BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO skill_definitions(code, display_name, active)
VALUES ('wicked_lord', '악덕한 영주', TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), active=VALUES(active);

INSERT INTO castle_states(code, display_name, lord_player_id, tax_rate, version)
VALUES ('hoi_castle', '호이캐슬', NULL, 5, 1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO configuration_sets(set_code, version, status, effective_from)
VALUES ('castle_tax', 1, 'active', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE status=VALUES(status);
