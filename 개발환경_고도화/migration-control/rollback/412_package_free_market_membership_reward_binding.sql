START TRANSACTION;

DELETE FROM package_reward_rules
WHERE rule_id='RULE-PACKAGE-5-FREE-MARKET-MEMBERSHIP-001'
  AND package_id='package_5';

DELETE FROM package_command_aliases WHERE package_id='package_5';
DELETE FROM package_catalog WHERE package_id='package_5';
DELETE FROM package_item_definitions WHERE item_id='package_5';
DELETE FROM item_definitions
WHERE code='package_5'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.legacySource'))='data/packageInfo.json';

-- canonical reward target free_market_membership는 migration382 소유이므로 보존합니다.
COMMIT;
