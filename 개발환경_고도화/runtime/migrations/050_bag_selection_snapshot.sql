CREATE TABLE bag_selection_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_bag_selection_player_latest (player_id, id),
  KEY idx_bag_selection_expiry (expires_at),
  CONSTRAINT fk_bag_selection_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bag_selection_snapshot_entries (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  display_seq INT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_object_id BIGINT UNSIGNED NULL,
  stack_version BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (snapshot_id, display_seq),
  UNIQUE KEY uq_bag_selection_item (snapshot_id, item_id),
  CONSTRAINT fk_bag_selection_entry_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES bag_selection_snapshots (id) ON DELETE CASCADE,
  CONSTRAINT fk_bag_selection_entry_item FOREIGN KEY (item_id)
    REFERENCES item_definitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bag_selection_entry_catalog FOREIGN KEY (catalog_object_id)
    REFERENCES object_registry (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
