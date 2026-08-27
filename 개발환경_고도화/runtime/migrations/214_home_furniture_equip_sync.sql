START TRANSACTION;
CREATE TABLE home_furniture_sync_backups(
 backup_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_operation_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(backup_key),
 CONSTRAINT fk_home_furniture_sync_backup_operation FOREIGN KEY(created_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE home_furniture_sync_backup_rows(
 backup_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 legacy_owned_quantity BIGINT UNSIGNED NOT NULL,
 legacy_placement_count BIGINT UNSIGNED NOT NULL,
 inventory_bag_count BIGINT UNSIGNED NOT NULL,
 inventory_placed_count BIGINT UNSIGNED NOT NULL,
 inventory_charm_total DECIMAL(30,3) NOT NULL,
 PRIMARY KEY(backup_key,player_id),
 CONSTRAINT fk_home_furniture_sync_backup_row FOREIGN KEY(backup_key) REFERENCES home_furniture_sync_backups(backup_key) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sync_backup_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE home_furniture_legacy_instance_links(
 owned_furniture_id BIGINT UNSIGNED NOT NULL,
 source_ordinal BIGINT UNSIGNED NOT NULL,
 furniture_instance_id BIGINT UNSIGNED NOT NULL,
 legacy_placement_id BIGINT UNSIGNED NULL,
 created_operation_id BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(owned_furniture_id,source_ordinal),
 UNIQUE KEY uq_home_furniture_sync_instance(furniture_instance_id),
 UNIQUE KEY uq_home_furniture_sync_placement(legacy_placement_id),
 CONSTRAINT fk_home_furniture_sync_owned FOREIGN KEY(owned_furniture_id) REFERENCES owned_furniture(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sync_instance FOREIGN KEY(furniture_instance_id) REFERENCES furniture_inventory_instances(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sync_link_operation FOREIGN KEY(created_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE home_furniture_sync_summaries(
 player_id BIGINT UNSIGNED NOT NULL,
 placed_count BIGINT UNSIGNED NOT NULL,
 total_charm DECIMAL(30,3) NOT NULL,
 royal_lumiere_count BIGINT UNSIGNED NOT NULL,
 grade_counts_json JSON NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 last_operation_id BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(player_id),
 CONSTRAINT fk_home_furniture_sync_summary_player FOREIGN KEY(player_id) REFERENCES player_homes(player_id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sync_summary_operation FOREIGN KEY(last_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE home_furniture_sync_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 operator_id BIGINT UNSIGNED NOT NULL,
 backup_status VARCHAR(32) NOT NULL,
 user_count BIGINT UNSIGNED NOT NULL,
 furniture_count BIGINT UNSIGNED NOT NULL,
 merged_count BIGINT UNSIGNED NOT NULL,
 summary_changed_count BIGINT UNSIGNED NOT NULL,
 bag_duplicate_removed_count BIGINT UNSIGNED NOT NULL,
 orphan_user_count BIGINT UNSIGNED NOT NULL,
 placement_promoted_count BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 CONSTRAINT fk_home_furniture_sync_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_home_furniture_sync_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES('HOME_FURNITURE_EQUIP_SYNC','home_furniture_equip_sync','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/장착가구동기화','HOME_FURNITURE_EQUIP_SYNC',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
