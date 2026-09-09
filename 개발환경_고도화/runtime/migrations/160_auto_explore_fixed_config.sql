START TRANSACTION;

CREATE TABLE pet_explore_runtime_config (
  config_id TINYINT UNSIGNED NOT NULL,
  event_mine_active BOOLEAN NOT NULL DEFAULT FALSE,
  guild_raid_active BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (config_id),
  CONSTRAINT chk_pet_explore_runtime_singleton CHECK (config_id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_explore_runtime_config(config_id,event_mine_active,guild_raid_active) VALUES (1,FALSE,FALSE)
ON DUPLICATE KEY UPDATE config_id=VALUES(config_id);

CREATE TABLE pet_explore_auto_fixed_configs (
  player_id BIGINT UNSIGNED NOT NULL,
  destination_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_operation_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_pet_explore_fixed_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_fixed_operation FOREIGN KEY (updated_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_auto_fixed_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  previous_destination_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  configured_destination_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  changed BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_pet_explore_fixed_change_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_fixed_change_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('PLAYER_AUTO_EXPLORE_FIXED_CONFIG','auto_explore_fixed_config','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/자동탐고정','PLAYER_AUTO_EXPLORE_FIXED_CONFIG',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
