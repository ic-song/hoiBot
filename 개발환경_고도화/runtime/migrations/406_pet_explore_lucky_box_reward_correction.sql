START TRANSACTION;

INSERT INTO pet_explore_settlement_policy_versions
  (policy_version,policy_hash,source_range,policy_document_json,status_code)
VALUES
  ('PET-EXPLORE-SETTLEMENT-v2.400-20260831-r1',
   '59e83e03c72b83fd6a397e88c664d18db89063fb9ea718c9130ea290c68a099a',
   'main.js:1347-1403,43614-43711,43733-44008,44491-44494,45384-45393,45741-45782; migration078/093 canonical reward identity',
   '{"baseBasisPoints":500,"destinationCount":11,"failureReward":{"itemCode":"pet_food","quantity":"2"},"formula":"max(0,base+tier+experience+lord+trait+pendant+homeBadge+upItem-penalty); premium excluded by settlement source","gaps":["archmage_random_reward","event_dungeon_reroute","guild_membership_recheck","maze_ticket_canonical_binding","premium_explore_bonus","threshold_over_100_percent","treasure_hunter_bonus","treasure_map_reward","up_item_consumption"],"rewardCorrections":{"luck_mine":{"from":"lucky_box","to":"reward_lucky_box","reason":"separate disabled package identity from active reward item identity"}},"source":"main.js:1347-1403,43614-43711,43733-44008,44491-44494,45384-45393,45741-45782","version":"PET-EXPLORE-SETTLEMENT-v2.400-20260831-r1"}',
   'PUBLISHED')
ON DUPLICATE KEY UPDATE
  policy_hash=VALUES(policy_hash),source_range=VALUES(source_range),
  policy_document_json=VALUES(policy_document_json),status_code='PUBLISHED';

INSERT INTO pet_explore_settlement_destination_policies
  (policy_version,destination_code,source_slot,ticket_policy,ticket_item_code,
   fallback_destinations_json,success_rewards_json,failure_rewards_json,source_gap_code)
SELECT
  'PET-EXPLORE-SETTLEMENT-v2.400-20260831-r1',destination_code,source_slot,ticket_policy,ticket_item_code,
  fallback_destinations_json,
  CASE WHEN destination_code='luck_mine'
    THEN JSON_ARRAY(JSON_OBJECT('itemCode','reward_lucky_box','quantity','1'))
    ELSE success_rewards_json
  END,
  failure_rewards_json,source_gap_code
FROM pet_explore_settlement_destination_policies
WHERE policy_version='PET-EXPLORE-SETTLEMENT-v2.400-20260831'
ON DUPLICATE KEY UPDATE
  source_slot=VALUES(source_slot),ticket_policy=VALUES(ticket_policy),
  ticket_item_code=VALUES(ticket_item_code),fallback_destinations_json=VALUES(fallback_destinations_json),
  success_rewards_json=VALUES(success_rewards_json),failure_rewards_json=VALUES(failure_rewards_json),
  source_gap_code=VALUES(source_gap_code);

UPDATE pet_explore_settlement_policy_versions
SET status_code='RETIRED'
WHERE policy_version='PET-EXPLORE-SETTLEMENT-v2.400-20260831'
  AND EXISTS (
    SELECT 1 FROM (
      SELECT policy_version FROM pet_explore_settlement_policy_versions
      WHERE policy_version='PET-EXPLORE-SETTLEMENT-v2.400-20260831-r1'
        AND status_code='PUBLISHED'
    ) AS published_correction
  );

COMMIT;
