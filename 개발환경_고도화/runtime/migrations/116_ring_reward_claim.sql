START TRANSACTION;

CREATE TABLE IF NOT EXISTS player_legacy_ring_reward_snapshots (
  player_id BIGINT UNSIGNED NOT NULL,
  ring_name VARCHAR(191) NOT NULL,
  ring_grade VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  enhancement_level BIGINT UNSIGNED NOT NULL,
  raid_charm BIGINT UNSIGNED NOT NULL,
  castle_charm BIGINT UNSIGNED NOT NULL,
  claim_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  reward_item_id BIGINT UNSIGNED NULL,
  reward_quantity BIGINT UNSIGNED NULL,
  claimed_operation_id BIGINT UNSIGNED NULL,
  source_version VARCHAR(64) NOT NULL,
  claimed_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_id),
  CONSTRAINT fk_ring_reward_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_ring_reward_snapshot_item FOREIGN KEY (reward_item_id) REFERENCES item_definitions(id),
  CONSTRAINT fk_ring_reward_snapshot_operation FOREIGN KEY (claimed_operation_id) REFERENCES operations(id),
  CONSTRAINT chk_ring_reward_snapshot_status CHECK (claim_status IN ('pending','claimed'))
);

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES ('ITEM-RING-CHARM-REWARD','반지매력보상🎁(/보상받기)','ITEM',1,JSON_OBJECT('source','legacy-ring-reward'),1,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=1,active=1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('RING_REWARD_CLAIM','ring_reward_claim','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/반지보상받기','RING_REWARD_CLAIM',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
