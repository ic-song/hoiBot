START TRANSACTION;

ALTER TABLE player_pet_pendants
  ADD COLUMN inventory_instance_id BIGINT UNSIGNED NULL AFTER player_pet_id,
  ADD UNIQUE KEY uq_player_pet_pendant_instance (inventory_instance_id),
  ADD CONSTRAINT fk_player_pet_pendant_instance FOREIGN KEY (inventory_instance_id)
    REFERENCES inventory_instances (id) ON DELETE RESTRICT;

CREATE TABLE pendant_upgrade_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  external_identity_id BIGINT UNSIGNED NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL,
  source_index INT UNSIGNED NOT NULL,
  target_version BIGINT UNSIGNED NOT NULL,
  next_level INT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL,
  stone_cost BIGINT UNSIGNED NOT NULL,
  base_rate DECIMAL(8,4) NOT NULL,
  bonus_rate DECIMAL(8,4) NOT NULL DEFAULT 0,
  source_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  consumed_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cancelled_at DATETIME(3) NULL,
  cancelled_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pendant_upgrade_active (player_id, consumed_at, cancelled_at, expires_at),
  CONSTRAINT fk_pendant_upgrade_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_upgrade_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pendant_upgrade_instance FOREIGN KEY (inventory_instance_id) REFERENCES inventory_instances (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PENDANT_ENHANCE','pendant_enhance','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/펜던트강화','PENDANT_ENHANCE',1),
('진행시켜','PENDANT_ENHANCE',1),
('쫄았음','PENDANT_ENHANCE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
