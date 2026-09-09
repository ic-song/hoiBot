START TRANSACTION;

INSERT INTO package_item_definitions
    (item_id, item_type, item_name, stackable, metadata_json, enabled, row_version)
VALUES
    ('ITEM-PACKAGE-CHICKEN-BOX', 'STACK', '치킨상자🐔', 1, '{"source":"legacy-main.js","legacyItemCode":"chicken_box"}', 0, 1),
    ('ITEM-RWD-SEASONED-CHICKEN', 'STACK', '양념치킨🐔', 1, '{"source":"legacy-main.js","legacyItemCode":"seasoned_chicken"}', 0, 1),
    ('ITEM-RWD-CASTLE-IMMORTAL', 'STACK', '캐슬불멸유닛🐉(+1500💕)', 1, '{"source":"legacy-main.js","legacyItemCode":"castle_immortal_unit"}', 0, 1),
    ('ITEM-RWD-CASTLE-MYTH', 'STACK', '캐슬신화유닛🧚🏻‍♀(+1000💕)', 1, '{"source":"legacy-main.js","legacyItemCode":"castle_myth_unit"}', 0, 1),
    ('ITEM-RWD-CASTLE-LEGEND', 'STACK', '캐슬전설유닛🧝🏻‍♀(+500💕)', 1, '{"source":"legacy-main.js","legacyItemCode":"castle_legend_unit"}', 0, 1),
    ('ITEM-RWD-CASTLE-HERO', 'STACK', '캐슬영웅유닛💠(+300💕)', 1, '{"source":"legacy-main.js","legacyItemCode":"castle_hero_unit"}', 0, 1),
    ('ITEM-RWD-CASTLE-UNIQUE', 'STACK', '캐슬유니크유닛👑(+200💕)', 1, '{"source":"legacy-main.js","legacyItemCode":"castle_unique_unit"}', 0, 1),
    ('ITEM-RWD-CASTLE-RARE', 'STACK', '캐슬레어유닛⭐(+100💕)', 1, '{"source":"legacy-main.js","legacyItemCode":"castle_rare_unit"}', 0, 1),
    ('ITEM-RWD-PET-FOOD-BOX', 'STACK', '펫먹이상자📦(/상자오픈)', 1, '{"source":"legacy-main.js","legacyItemCode":"pet_food_box"}', 0, 1),
    ('ITEM-RWD-TRASH-BOX', 'STACK', '잡템상자☠', 1, '{"source":"legacy-main.js","legacyItemCode":"trash_box"}', 0, 1)
ON DUPLICATE KEY UPDATE
    item_type = VALUES(item_type),
    item_name = VALUES(item_name),
    stackable = VALUES(stackable),
    metadata_json = VALUES(metadata_json),
    enabled = VALUES(enabled);

INSERT INTO item_definitions
    (code, display_name, asset_type_code, stackable, metadata_json, active, version)
SELECT item_id, item_name, 'PACKAGE_ITEM', 1, metadata_json, 0, 1
FROM package_item_definitions
WHERE item_id IN (
    'ITEM-PACKAGE-CHICKEN-BOX',
    'ITEM-RWD-SEASONED-CHICKEN',
    'ITEM-RWD-CASTLE-IMMORTAL',
    'ITEM-RWD-CASTLE-MYTH',
    'ITEM-RWD-CASTLE-LEGEND',
    'ITEM-RWD-CASTLE-HERO',
    'ITEM-RWD-CASTLE-UNIQUE',
    'ITEM-RWD-CASTLE-RARE',
    'ITEM-RWD-PET-FOOD-BOX',
    'ITEM-RWD-TRASH-BOX'
)
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    metadata_json = VALUES(metadata_json),
    active = VALUES(active);

INSERT INTO package_catalog
    (package_id, catalog_version, display_name, description, consume_item_id,
     display_order, max_open_count, block_castle, definition_status, enabled, row_version)
VALUES
    ('PKG-CHICKEN-BOX', 'DRAFT-20260825', '치킨상자🐔', '양념치킨 5~10개 균등 보상', 'ITEM-PACKAGE-CHICKEN-BOX',
     30, 1000, 1, 'RULES_SEEDED_DRAFT', 0, 1),
    ('PKG-CASTLE-CARD', 'DRAFT-20260825', '캐슬카드 패키지', '펫먹이특식 소비 9단계 캐슬 보상', 'ITEM-RWD-024',
     31, 1000, 1, 'RULES_SEEDED_DRAFT', 0, 1)
ON DUPLICATE KEY UPDATE
    catalog_version = VALUES(catalog_version),
    display_name = VALUES(display_name),
    description = VALUES(description),
    consume_item_id = VALUES(consume_item_id),
    display_order = VALUES(display_order),
    max_open_count = VALUES(max_open_count),
    block_castle = VALUES(block_castle),
    definition_status = VALUES(definition_status),
    enabled = VALUES(enabled);

INSERT INTO package_reward_rules
    (rule_id, package_id, reward_order, group_code, rule_mode, operation, owner_scope,
     item_id, quantity, weight, range_min, range_max, range_step,
     target_selector, metadata_override_json, selector_json, enabled)
VALUES
    ('RULE-PKG-CHICKEN-001', 'PKG-CHICKEN-BOX', 1, 'CHICKEN', 'UNIFORM_RANGE', 'ADD', 'USER',
     'ITEM-RWD-SEASONED-CHICKEN', 1, NULL, 5, 10, 1, NULL,
     '{"sourceCommand":"/치킨오픈","legacyRewardCode":"seasoned_chicken"}', NULL, 1),
    ('RULE-PKG-CARD-001', 'PKG-CASTLE-CARD', 1, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-CASTLE-IMMORTAL', 1, 0.0003000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈","specialMessage":"🌟 초대박!! 불멸유닛 등장!! 🌟"}', NULL, 1),
    ('RULE-PKG-CARD-002', 'PKG-CASTLE-CARD', 2, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-CASTLE-MYTH', 1, 0.0007000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈","specialMessage":"✨ 신화급 유닛 등장!! ✨"}', NULL, 1),
    ('RULE-PKG-CARD-003', 'PKG-CASTLE-CARD', 3, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-CASTLE-LEGEND', 1, 0.0030000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈"}', NULL, 1),
    ('RULE-PKG-CARD-004', 'PKG-CASTLE-CARD', 4, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-CASTLE-HERO', 1, 0.0100000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈"}', NULL, 1),
    ('RULE-PKG-CARD-005', 'PKG-CASTLE-CARD', 5, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-CASTLE-UNIQUE', 1, 0.0300000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈"}', NULL, 1),
    ('RULE-PKG-CARD-006', 'PKG-CASTLE-CARD', 6, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-CASTLE-RARE', 1, 0.0700000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈"}', NULL, 1),
    ('RULE-PKG-CARD-007', 'PKG-CASTLE-CARD', 7, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-025', 4, 0.0500000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈","legacyRewardCode":"pet_food"}', NULL, 1),
    ('RULE-PKG-CARD-008', 'PKG-CASTLE-CARD', 8, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-PET-FOOD-BOX', 1, 0.1500000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈","legacyRewardCode":"pet_food_box"}', NULL, 1),
    ('RULE-PKG-CARD-009', 'PKG-CASTLE-CARD', 9, 'CASTLE_CARD', 'WEIGHTED_ONE', 'ADD', 'USER',
     'ITEM-RWD-TRASH-BOX', 1, 0.6860000000, NULL, NULL, NULL, NULL,
     '{"sourceCommand":"/카드오픈","legacyRewardCode":"trash_box"}', NULL, 1)
ON DUPLICATE KEY UPDATE
    package_id = VALUES(package_id),
    reward_order = VALUES(reward_order),
    group_code = VALUES(group_code),
    rule_mode = VALUES(rule_mode),
    operation = VALUES(operation),
    owner_scope = VALUES(owner_scope),
    item_id = VALUES(item_id),
    quantity = VALUES(quantity),
    weight = VALUES(weight),
    range_min = VALUES(range_min),
    range_max = VALUES(range_max),
    range_step = VALUES(range_step),
    metadata_override_json = VALUES(metadata_override_json),
    enabled = VALUES(enabled);

DELETE FROM package_command_aliases
WHERE package_id IN ('PKG-CHICKEN-BOX', 'PKG-CASTLE-CARD');

COMMIT;
