INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('tier_promotion_ticket', '티어 승급티켓🎟', 'item', TRUE, JSON_OBJECT('slice', 'SL-CRAFT-ADVANCED-TIER-TICKET'), TRUE, 1),
  ('legendary_stone', '전설의 돌맹이🗿', 'item', TRUE, JSON_OBJECT('slice', 'SL-CRAFT-ADVANCED-TIER-TICKET'), TRUE, 1),
  ('pet_enhance_stone', '펫 강화석⭐', 'item', TRUE, JSON_OBJECT('slice', 'SL-CRAFT-ADVANCED-TIER-TICKET'), TRUE, 1),
  ('advanced_tier_promotion_ticket', '고급 티어 승급티켓🎫', 'item', TRUE, JSON_OBJECT('slice', 'SL-CRAFT-ADVANCED-TIER-TICKET'), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE;
