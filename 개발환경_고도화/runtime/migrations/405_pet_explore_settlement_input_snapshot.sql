START TRANSACTION;

CREATE TABLE pet_explore_settlement_policy_versions (
  policy_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_range VARCHAR(500) NOT NULL,
  policy_document_json JSON NOT NULL,
  status_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (policy_version), UNIQUE KEY uq_pet_explore_settlement_policy_hash (policy_hash),
  CONSTRAINT chk_pet_explore_settlement_policy_status CHECK (status_code IN ('PUBLISHED','RETIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_destination_policies (
  policy_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_slot VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticket_policy VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticket_item_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  fallback_destinations_json JSON NULL,
  success_rewards_json JSON NOT NULL,
  failure_rewards_json JSON NOT NULL,
  source_gap_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (policy_version,destination_code), UNIQUE KEY uq_pet_explore_policy_source_slot (policy_version,source_slot),
  CONSTRAINT fk_pet_explore_destination_policy_version FOREIGN KEY (policy_version) REFERENCES pet_explore_settlement_policy_versions(policy_version) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_destination_ticket_policy CHECK (ticket_policy IN ('none','consume_or_fail','consume_or_regular_fallback'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_participant_source_projections (
  participation_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  source_revision VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  threshold_components_json JSON NOT NULL,
  source_gap_codes_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (participation_id),
  UNIQUE KEY uq_pet_explore_source_round_player (round_id,player_id),
  CONSTRAINT fk_pet_explore_source_participation FOREIGN KEY (participation_id) REFERENCES pet_explore_participations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_source_round FOREIGN KEY (round_id) REFERENCES pet_explore_rounds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_source_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_input_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  policy_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_pet_explore_input_snapshot_operation (operation_id), UNIQUE KEY uq_pet_explore_input_snapshot_round (round_id),
  CONSTRAINT fk_pet_explore_input_snapshot_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_input_snapshot_round FOREIGN KEY (round_id) REFERENCES pet_explore_rounds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_input_snapshot_policy FOREIGN KEY (policy_version) REFERENCES pet_explore_settlement_policy_versions(policy_version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_input_participant_plans (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  plan_sequence INT UNSIGNED NOT NULL,
  participation_id BIGINT UNSIGNED NOT NULL,
  destination_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  success_threshold_basis_points INT UNSIGNED NOT NULL,
  threshold_components_json JSON NOT NULL,
  plan_json JSON NOT NULL,
  PRIMARY KEY (snapshot_id,plan_sequence), UNIQUE KEY uq_pet_explore_input_participation (snapshot_id,participation_id),
  CONSTRAINT fk_pet_explore_input_plan_snapshot FOREIGN KEY (snapshot_id) REFERENCES pet_explore_settlement_input_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_input_plan_participation FOREIGN KEY (participation_id) REFERENCES pet_explore_participations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_input_threshold CHECK (success_threshold_basis_points <= 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_settlement_input_next_auto_plans (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  plan_sequence INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  reservation_json JSON NOT NULL,
  PRIMARY KEY (snapshot_id,plan_sequence), UNIQUE KEY uq_pet_explore_input_next_player (snapshot_id,player_id),
  CONSTRAINT fk_pet_explore_input_next_snapshot FOREIGN KEY (snapshot_id) REFERENCES pet_explore_settlement_input_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_input_next_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_explore_settlement_policy_versions(policy_version,policy_hash,source_range,policy_document_json,status_code) VALUES
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','add32011c8ee93c4fd12be37f2a2dc5615f8dbfc967c6e5c8a9892799d14779f','main.js:1347-1403,43614-43711,43733-44008,44491-44494,45384-45393,45741-45782','{"baseBasisPoints":500,"destinationCount":11,"failureReward":{"itemCode":"pet_food","quantity":"2"},"formula":"max(0,base+tier+experience+lord+trait+pendant+homeBadge+upItem-penalty); premium excluded by settlement source","gaps":["archmage_random_reward","event_dungeon_reroute","guild_membership_recheck","maze_ticket_canonical_binding","premium_explore_bonus","threshold_over_100_percent","treasure_hunter_bonus","treasure_map_reward","up_item_consumption"],"source":"main.js:1347-1403,43614-43711,43733-44008,44491-44494,45384-45393,45741-45782","version":"PET-EXPLORE-SETTLEMENT-v2.400-20260831"}','PUBLISHED');

INSERT INTO pet_explore_settlement_destination_policies(policy_version,destination_code,source_slot,ticket_policy,ticket_item_code,fallback_destinations_json,success_rewards_json,failure_rewards_json,source_gap_code) VALUES
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','diamond_mine_event','0','none',NULL,NULL,'[{"itemCode":"ITEM-DIAMOND-MINE-BOX","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','pet_enhancement_mine','1','none',NULL,NULL,'[{"itemCode":"enhance_dungeon_box","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','intimacy_mine','2','none',NULL,NULL,'[{"itemCode":"pet_food_dungeon_box","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','luck_mine','3','none',NULL,NULL,'[{"itemCode":"lucky_box","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','jeondor_dungeon','4','consume_or_regular_fallback','ITEM-PET-DUNGEON-ENTRY-TICKET','["pet_enhancement_mine","intimacy_mine","luck_mine"]','[{"itemCode":"ITEM-DUNGEON-JEONDOR-BOX","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','chicken_farm_dungeon','5','consume_or_regular_fallback','ITEM-PET-DUNGEON-ENTRY-TICKET','["pet_enhancement_mine","intimacy_mine","luck_mine"]','[{"itemCode":"ITEM-DUNGEON-CHICKEN-BOX","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','land_document_dungeon','6','consume_or_regular_fallback','ITEM-PET-DUNGEON-ENTRY-TICKET','["pet_enhancement_mine","intimacy_mine","luck_mine"]','[{"itemCode":"ITEM-PACKAGE-LAND-DOCUMENT-DUNGEON-BOX","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','shop_open_dungeon','7','consume_or_regular_fallback','ITEM-PET-DUNGEON-ENTRY-TICKET','["pet_enhancement_mine","intimacy_mine","luck_mine"]','[{"itemCode":"ITEM-DUNGEON-SHOP-OPEN-BOX","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]',NULL),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','belcar_maze','8','consume_or_fail',NULL,NULL,'[{"itemCode":"ITEM-DUNGEON-PENDANT-MAZE-BOX","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]','maze_ticket_canonical_binding'),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','archmage_ruins','9','consume_or_fail',NULL,NULL,'[]','[{"itemCode":"pet_food","quantity":"2"}]','archmage_random_reward'),
('PET-EXPLORE-SETTLEMENT-v2.400-20260831','guild_raid_event','10','consume_or_fail','ITEM-PET-DUNGEON-ENTRY-TICKET',NULL,'[{"itemCode":"guild_raid_dungeon_box","quantity":"1"}]','[{"itemCode":"pet_food","quantity":"2"}]','guild_membership_recheck');

INSERT INTO pet_explore_settlement_policy_gaps(gap_code,status_code,legacy_source_value,canonical_policy_version,reason_text) VALUES
('archmage_random_reward','RED','rollArchmageMazeBox',NULL,'random auto-open reward is not representable by settlement item reward plan'),
('event_dungeon_reroute','RED','regular mine 5 percent reroute',NULL,'event dungeon destination and reward binding are not represented by the provider input'),
('guild_membership_recheck','RED','getMyGuildId at settlement',NULL,'settlement provider does not yet recheck guild membership'),
('maze_ticket_canonical_binding','RED','미궁 입장권🕋',NULL,'canonical ItemProvider code for the maze ticket is not proven'),
('threshold_over_100_percent','RED','unclamped doPetExploreInterval totalP',NULL,'provider accepts at most 10000 basis points while legacy settlement does not clamp'),
('treasure_hunter_bonus','RED','15 percent duplicate reward',NULL,'additional reward RNG is outside the provider input'),
('treasure_map_reward','RED','2 percent weekly box and conditional consume',NULL,'treasure-map mutation and RNG are outside the provider input'),
('up_item_consumption','RED','highest explore boost item consume',NULL,'threshold component is known but item consumption is outside the provider input')
ON DUPLICATE KEY UPDATE gap_code=VALUES(gap_code);

COMMIT;
