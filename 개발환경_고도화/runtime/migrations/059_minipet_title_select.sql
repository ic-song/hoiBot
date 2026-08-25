CREATE TABLE mini_pet_title_owned_states (
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id, title_id),
  UNIQUE KEY uq_minipet_title_owned_stable (stable_owned_title_id),
  UNIQUE KEY uq_minipet_title_owned_order (player_id, display_order),
  CONSTRAINT fk_minipet_title_owned_player_title FOREIGN KEY (player_id,title_id) REFERENCES player_titles(player_id,title_id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_title_owned_order CHECK (display_order BETWEEN 1 AND 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_title_selections (
  player_id BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  selected_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_minipet_title_selection_player_title FOREIGN KEY (player_id,title_id) REFERENCES player_titles(player_id,title_id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_selection_stable FOREIGN KEY (stable_owned_title_id) REFERENCES mini_pet_title_owned_states(stable_owned_title_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_title_selection_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  before_title_id BIGINT UNSIGNED NULL,
  after_title_id BIGINT UNSIGNED NOT NULL,
  stable_owned_title_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selected_index SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_minipet_title_selection_player (player_id,created_at),
  CONSTRAINT fk_minipet_title_selection_event_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_selection_event_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_selection_event_before FOREIGN KEY (before_title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_title_selection_event_after FOREIGN KEY (after_title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_title_selection_event_index CHECK (selected_index BETWEEN 1 AND 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
