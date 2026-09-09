CREATE TABLE pet_intimacy (
  pet_id BIGINT UNSIGNED NOT NULL,
  progress BIGINT UNSIGNED NOT NULL DEFAULT 0,
  level_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  charm_bonus BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (pet_id),
  CONSTRAINT fk_pet_intimacy_pet FOREIGN KEY (pet_id) REFERENCES player_pets(id) ON DELETE CASCADE,
  CONSTRAINT chk_pet_intimacy_progress CHECK (progress < 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_feed_operations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  pet_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  status_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_quantity BIGINT UNSIGNED NOT NULL,
  consumed_quantity BIGINT UNSIGNED NOT NULL,
  feed_before BIGINT UNSIGNED NULL,
  feed_after BIGINT UNSIGNED NULL,
  progress_before BIGINT UNSIGNED NULL,
  progress_after BIGINT UNSIGNED NULL,
  level_before BIGINT UNSIGNED NULL,
  level_after BIGINT UNSIGNED NULL,
  charm_before BIGINT UNSIGNED NULL,
  charm_after BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_pet_feed_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pet_feed_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_pet_feed_pet FOREIGN KEY (pet_id) REFERENCES player_pets(id),
  CONSTRAINT fk_pet_feed_item FOREIGN KEY (item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_FEED_INTIMACY','pet_feed_intimacy','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/냠냠','PET_FEED_INTIMACY',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
