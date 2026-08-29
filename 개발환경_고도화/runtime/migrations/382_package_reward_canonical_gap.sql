START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES
  ('pet_enhance_stone','펫 강화석⭐','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','legacyCode','ITEM-RWD-026','canonicalState','ACTIVE'),TRUE,1),
  ('police_thief_ticket','경찰과 도둑🚨(/삐뽀삐뽀)','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','legacyCode','ITEM-RWD-047','canonicalState','ACTIVE'),TRUE,1),
  ('free_market_membership','자유시장회원권🏪','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','legacySource','data/packageInfo.json','canonicalState','ACTIVE'),TRUE,1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stackable=TRUE,
  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)),
  active=TRUE;

UPDATE item_definitions
SET active=TRUE,
    metadata_json=JSON_MERGE_PATCH(
      COALESCE(metadata_json,JSON_OBJECT()),
      JSON_OBJECT('sourceContract','v2.400','canonicalState','ACTIVE','packageRewardTarget',TRUE)
    )
WHERE code='legacy-seasoned-chicken';

INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
VALUES
  ('pet_enhance_stone','STACK','펫 강화석⭐',TRUE,JSON_OBJECT('sourceContract','v2.400','canonicalItemCode','pet_enhance_stone'),TRUE,1),
  ('police_thief_ticket','STACK','경찰과 도둑🚨(/삐뽀삐뽀)',TRUE,JSON_OBJECT('sourceContract','v2.400','canonicalItemCode','police_thief_ticket'),TRUE,1),
  ('free_market_membership','STACK','자유시장회원권🏪',TRUE,JSON_OBJECT('sourceContract','v2.400','canonicalItemCode','free_market_membership'),TRUE,1),
  ('legacy-seasoned-chicken','STACK','양념치킨🐔',TRUE,JSON_OBJECT('sourceContract','v2.400','canonicalItemCode','legacy-seasoned-chicken'),TRUE,1)
ON DUPLICATE KEY UPDATE
  item_type='STACK',
  item_name=VALUES(item_name),
  stackable=TRUE,
  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)),
  enabled=TRUE;

UPDATE package_reward_rules
SET item_id=CASE item_id
  WHEN 'ITEM-RWD-026' THEN 'pet_enhance_stone'
  WHEN 'ITEM-RWD-047' THEN 'police_thief_ticket'
  WHEN 'ITEM-RWD-SEASONED-CHICKEN' THEN 'legacy-seasoned-chicken'
  ELSE item_id
END
WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN');

UPDATE package_rewards
SET item_id=CASE item_id
  WHEN 'ITEM-RWD-026' THEN 'pet_enhance_stone'
  WHEN 'ITEM-RWD-047' THEN 'police_thief_ticket'
  WHEN 'ITEM-RWD-SEASONED-CHICKEN' THEN 'legacy-seasoned-chicken'
  ELSE item_id
END
WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN');

UPDATE package_reward_bundle_items
SET item_id=CASE item_id
  WHEN 'ITEM-RWD-026' THEN 'pet_enhance_stone'
  WHEN 'ITEM-RWD-047' THEN 'police_thief_ticket'
  WHEN 'ITEM-RWD-SEASONED-CHICKEN' THEN 'legacy-seasoned-chicken'
  ELSE item_id
END
WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN');

UPDATE dynamic_item_catalog_entries
SET item_id=CASE item_id
  WHEN 'ITEM-RWD-026' THEN 'pet_enhance_stone'
  WHEN 'ITEM-RWD-047' THEN 'police_thief_ticket'
  WHEN 'ITEM-RWD-SEASONED-CHICKEN' THEN 'legacy-seasoned-chicken'
  ELSE item_id
END
WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN');

UPDATE item_definitions
SET active=FALSE,
    metadata_json=JSON_MERGE_PATCH(
      COALESCE(metadata_json,JSON_OBJECT()),
      JSON_OBJECT(
        'canonicalState','COMPATIBILITY',
        'canonicalReplacement',CASE code
          WHEN 'ITEM-RWD-026' THEN 'pet_enhance_stone'
          WHEN 'ITEM-RWD-047' THEN 'police_thief_ticket'
          WHEN 'ITEM-RWD-SEASONED-CHICKEN' THEN 'legacy-seasoned-chicken'
          ELSE NULL
        END
      )
    )
WHERE code IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN');

UPDATE package_item_definitions
SET enabled=FALSE,
    metadata_json=JSON_MERGE_PATCH(
      COALESCE(metadata_json,JSON_OBJECT()),
      JSON_OBJECT(
        'canonicalState','COMPATIBILITY',
        'canonicalReplacement',CASE item_id
          WHEN 'ITEM-RWD-026' THEN 'pet_enhance_stone'
          WHEN 'ITEM-RWD-047' THEN 'police_thief_ticket'
          WHEN 'ITEM-RWD-SEASONED-CHICKEN' THEN 'legacy-seasoned-chicken'
          ELSE NULL
        END
      )
    )
WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN');

COMMIT;
