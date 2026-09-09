START TRANSACTION;

CREATE TABLE IF NOT EXISTS raid_charm_rank_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  source_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  eligible_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_raid_charm_rank_snapshot_operation(operation_id),
  CONSTRAINT fk_raid_charm_rank_snapshot_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raid_charm_rank_entries (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  ordinal_value INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  pet_id BIGINT UNSIGNED NOT NULL,
  source_order BIGINT UNSIGNED NULL,
  pet_image VARCHAR(500) NOT NULL,
  pet_title VARCHAR(191) NOT NULL,
  pet_name VARCHAR(191) NOT NULL,
  item_raid_charm BIGINT UNSIGNED NOT NULL,
  pet_experience BIGINT UNSIGNED NOT NULL,
  mini_pet_raid_charm BIGINT UNSIGNED NOT NULL,
  home_charm BIGINT UNSIGNED NOT NULL,
  personal_cube_percent DECIMAL(6,3) NOT NULL,
  guild_cube_units BIGINT UNSIGNED NOT NULL,
  final_raid_charm BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(snapshot_id,ordinal_value),
  UNIQUE KEY uq_raid_charm_rank_snapshot_player(snapshot_id,player_id),
  CONSTRAINT fk_raid_charm_rank_entry_snapshot FOREIGN KEY(snapshot_id) REFERENCES raid_charm_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_raid_charm_rank_entry_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_raid_charm_rank_entry_pet FOREIGN KEY(pet_id) REFERENCES player_pets(id) ON DELETE RESTRICT,
  CONSTRAINT ck_raid_charm_rank_guild_units CHECK(guild_cube_units<=500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('RAID_CHARM_RANKING_READ','raid_charm_ranking_read','TRUSTED_DISPLAY_NAME','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/레이드매력순위','RAID_CHARM_RANKING_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
