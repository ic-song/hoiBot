CREATE TABLE inventory_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_count BIGINT UNSIGNED NOT NULL,
  item_count BIGINT UNSIGNED NOT NULL,
  quantity_total DECIMAL(65,0) NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_snapshot_operation (operation_id),
  CONSTRAINT fk_inventory_snapshot_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_snapshot_entries (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  inventory_version BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (snapshot_id, player_id, item_id),
  CONSTRAINT fk_inventory_snapshot_entry_snapshot FOREIGN KEY (snapshot_id) REFERENCES inventory_snapshots (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_snapshot_entry_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_snapshot_entry_item FOREIGN KEY (item_id) REFERENCES item_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
