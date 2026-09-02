-- WBS737: member, pet, and mini-pet titles retain separate definitions and ownership semantics.
-- Requires 443_object_identity_audit_provider.sql and 444_canonical_item_inventory.sql for canonical_players(player_id).

CREATE TABLE canonical_member_title_definitions (
  member_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  base_sale_price BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (member_title_id),
  CONSTRAINT chk_canonical_member_title_definition_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_member_title_definition_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_member_title_instances (
  owned_member_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  member_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acquisition_sequence BIGINT UNSIGNED NOT NULL,
  acquired_time CHAR(19) NOT NULL,
  ownership_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_member_title_id),
  UNIQUE KEY uq_canonical_owned_member_title_owner (owned_member_title_id, player_id),
  UNIQUE KEY uq_canonical_owned_member_title_sequence (player_id, acquisition_sequence),
  CONSTRAINT fk_canonical_owned_member_title_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_member_title_definition FOREIGN KEY (member_title_id) REFERENCES canonical_member_title_definitions (member_title_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_member_title_status CHECK (ownership_status IN ('owned','sold','removed')),
  CONSTRAINT chk_canonical_owned_member_title_acquired_time CHECK (acquired_time REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_member_title_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_member_title_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_member_title_selections (
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_member_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_id),
  CONSTRAINT fk_canonical_member_title_selection_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_member_title_selection_owned FOREIGN KEY (owned_member_title_id, player_id) REFERENCES canonical_owned_member_title_instances (owned_member_title_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_member_title_selection_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_member_title_selection_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_pet_title_definitions (
  pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  base_sale_price BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (pet_title_id),
  CONSTRAINT chk_canonical_pet_title_definition_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_title_definition_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_pet_title_instances (
  owned_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acquisition_sequence BIGINT UNSIGNED NOT NULL,
  acquired_time CHAR(19) NOT NULL,
  ownership_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_pet_title_id),
  UNIQUE KEY uq_canonical_owned_pet_title_owner (owned_pet_title_id, player_id),
  UNIQUE KEY uq_canonical_owned_pet_title_sequence (player_id, acquisition_sequence),
  CONSTRAINT fk_canonical_owned_pet_title_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_pet_title_definition FOREIGN KEY (pet_title_id) REFERENCES canonical_pet_title_definitions (pet_title_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_pet_title_status CHECK (ownership_status IN ('owned','sold','removed')),
  CONSTRAINT chk_canonical_owned_pet_title_acquired_time CHECK (acquired_time REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_pet_title_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_pet_title_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_pet_title_selections (
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_id),
  CONSTRAINT fk_canonical_pet_title_selection_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_pet_title_selection_owned FOREIGN KEY (owned_pet_title_id, player_id) REFERENCES canonical_owned_pet_title_instances (owned_pet_title_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_pet_title_selection_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_pet_title_selection_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_mini_pet_title_definitions (
  mini_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  base_sale_price BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (mini_pet_title_id),
  CONSTRAINT chk_canonical_mini_pet_title_definition_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_mini_pet_title_definition_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_owned_mini_pet_title_instances (
  owned_mini_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mini_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acquisition_sequence BIGINT UNSIGNED NOT NULL,
  acquired_time CHAR(19) NOT NULL,
  ownership_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (owned_mini_pet_title_id),
  UNIQUE KEY uq_canonical_owned_mini_pet_title_owner (owned_mini_pet_title_id, player_id),
  UNIQUE KEY uq_canonical_owned_mini_pet_title_sequence (player_id, acquisition_sequence),
  CONSTRAINT fk_canonical_owned_mini_pet_title_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_owned_mini_pet_title_definition FOREIGN KEY (mini_pet_title_id) REFERENCES canonical_mini_pet_title_definitions (mini_pet_title_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_owned_mini_pet_title_status CHECK (ownership_status IN ('owned','sold','removed')),
  CONSTRAINT chk_canonical_owned_mini_pet_title_acquired_time CHECK (acquired_time REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_mini_pet_title_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_owned_mini_pet_title_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_mini_pet_title_selections (
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_mini_pet_title_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (player_id),
  CONSTRAINT fk_canonical_mini_pet_title_selection_player FOREIGN KEY (player_id) REFERENCES canonical_players (player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_mini_pet_title_selection_owned FOREIGN KEY (owned_mini_pet_title_id, player_id) REFERENCES canonical_owned_mini_pet_title_instances (owned_mini_pet_title_id, player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_mini_pet_title_selection_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_mini_pet_title_selection_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
