START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('castle_crown_box','👑크라운 상자(/크라운오픈)','STACK',1,JSON_OBJECT('source','castleBattle2.json','domain','castle_battle_reward'),1,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=VALUES(active),version=VALUES(version);

CREATE TABLE castle_battle_season_reward_rule_items (
  tier_point INT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'castleBattle2.json',
  PRIMARY KEY(tier_point,sequence_no),
  UNIQUE KEY uq_castle_season_reward_tier_item(tier_point,item_id),
  CONSTRAINT fk_castle_season_reward_rule_rank FOREIGN KEY(tier_point) REFERENCES castle_battle_rank_definitions(tier_point) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_reward_rule_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_castle_season_reward_quantity CHECK(quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO castle_battle_season_reward_rule_items(tier_point,sequence_no,item_id,quantity)
SELECT rank.tier_point,1,item.id,1 FROM castle_battle_rank_definitions rank JOIN item_definitions item ON item.code=CASE
  WHEN rank.tier_point BETWEEN 1 AND 3 THEN 'ITEM-PACKAGE-210' WHEN rank.tier_point BETWEEN 4 AND 6 THEN 'castle_ace_box'
  WHEN rank.tier_point BETWEEN 7 AND 9 THEN 'ITEM-PACKAGE-209' WHEN rank.tier_point BETWEEN 10 AND 12 THEN 'castle_crown_box'
  WHEN rank.tier_point BETWEEN 13 AND 15 THEN 'ITEM-PACKAGE-213' WHEN rank.tier_point BETWEEN 16 AND 18 THEN 'ITEM-PACKAGE-211'
  WHEN rank.tier_point BETWEEN 19 AND 21 THEN 'castle_emperor_box' ELSE 'castle_almighty_box' END
ON DUPLICATE KEY UPDATE item_id=VALUES(item_id),quantity=VALUES(quantity),source_key='castleBattle2.json';

INSERT INTO castle_battle_season_reward_rule_items(tier_point,sequence_no,item_id,quantity)
SELECT rank.tier_point,2,item.id,CASE rank.tier_point
  WHEN 1 THEN 30 WHEN 2 THEN 30 WHEN 3 THEN 30 WHEN 4 THEN 30 WHEN 5 THEN 30 WHEN 6 THEN 40
  WHEN 7 THEN 50 WHEN 8 THEN 50 WHEN 9 THEN 60 WHEN 10 THEN 60 WHEN 11 THEN 60 WHEN 12 THEN 70
  WHEN 13 THEN 70 WHEN 14 THEN 70 WHEN 15 THEN 80 WHEN 16 THEN 80 WHEN 17 THEN 80 WHEN 18 THEN 100
  WHEN 19 THEN 110 WHEN 20 THEN 120 WHEN 21 THEN 130 WHEN 22 THEN 200 WHEN 23 THEN 250 WHEN 24 THEN 300 END
FROM castle_battle_rank_definitions rank JOIN item_definitions item ON item.code='castle_coin'
ON DUPLICATE KEY UPDATE item_id=VALUES(item_id),quantity=VALUES(quantity),source_key='castleBattle2.json';

CREATE TABLE castle_battle_season_reward_runs (
  request_key VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  rewarded_player_count BIGINT UNSIGNED NOT NULL,
  grant_count BIGINT UNSIGNED NOT NULL,
  total_item_quantity BIGINT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(request_key),
  UNIQUE KEY uq_castle_season_reward_operation(operation_id),
  UNIQUE KEY uq_castle_season_reward_season(season_id),
  UNIQUE KEY uq_castle_season_reward_snapshot(snapshot_id),
  CONSTRAINT fk_castle_season_reward_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_reward_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_reward_season FOREIGN KEY(season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_reward_snapshot FOREIGN KEY(snapshot_id) REFERENCES castle_battle_rank_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT chk_castle_season_reward_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_battle_season_reward_grants (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  rank_display INT UNSIGNED NOT NULL,
  tier_point INT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(operation_id,player_id,sequence_no),
  CONSTRAINT fk_castle_season_grant_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_grant_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_grant_rank FOREIGN KEY(tier_point) REFERENCES castle_battle_rank_definitions(tier_point) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_grant_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_season_grant_snapshot FOREIGN KEY(snapshot_id) REFERENCES castle_battle_rank_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('CASTLE_BATTLE_SEASON_CLOSE_REWARD','castle_battle_season_close_reward','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/캐슬대전시즌종료','CASTLE_BATTLE_SEASON_CLOSE_REWARD',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
