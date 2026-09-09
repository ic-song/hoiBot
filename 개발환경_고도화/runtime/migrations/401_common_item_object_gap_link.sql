SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_common_item_object_gap_401 (
  definition_code VARCHAR(128) NOT NULL PRIMARY KEY,
  source_migration VARCHAR(191) NOT NULL,
  frozen_only TINYINT(1) NOT NULL DEFAULT 0
);

INSERT INTO tmp_common_item_object_gap_401 (definition_code, source_migration) VALUES
('auto_daily_quest_ticket','249_auto_daily_quest_orchestration.sql'),
('castle_crown_box','334_castle_battle_season_close_reward.sql'),
('furniture_draw','372_guild_contribution_apply.sql'),
('guild_great_rift_guide','327_guild_territory_rift_control.sql'),
('guild_instability_down','327_guild_territory_rift_control.sql'),
('guild_instability_up','327_guild_territory_rift_control.sql'),
('guild_pendant_stock','362_admin_guild_warehouse_resource_grant.sql'),
('guild_rift_guide','327_guild_territory_rift_control.sql'),
('HAPPY_FOUNDATION_MEMBERSHIP','307_happy_foundation_transfer_fee.sql'),
('ITEM-FORTUNE-ALLOWANCE','379_inventory_fortune_pouch_open.sql'),
('ITEM-FORTUNE-EXECUTION-SWORD','379_inventory_fortune_pouch_open.sql'),
('ITEM-FORTUNE-IMMORTAL','379_inventory_fortune_pouch_open.sql'),
('ITEM-FREE-HOI-SUPPORT-01','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-03','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-04','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-05','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-06','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-07','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-08','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-09','338_admin_package_delete.sql'),
('ITEM-FREE-HOI-SUPPORT-10','338_admin_package_delete.sql'),
('ITEM-GUILD-CREATE-TICKET','358_guild_create.sql'),
('ITEM-GUILD-MARK-CHANGE-TICKET','357_guild_mark_mutate.sql'),
('ITEM-GUILD-NAME-RENAME-TICKET','342_guild_name_rename.sql'),
('ITEM-GUILD-TERRITORY-BOOSTER','359_guild_territory_booster_contribute.sql'),
('ITEM-HOME-BADGE-CUBE','376_home_badge_cube.sql'),
('ITEM-HOME-BADGE-GACHA-TICKET-1','375_home_badge_gacha_open.sql'),
('ITEM-HOME-BADGE-GACHA-TICKET-2','375_home_badge_gacha_open.sql'),
('ITEM-HOME-BADGE-GACHA-TICKET-3','375_home_badge_gacha_open.sql'),
('ITEM-LEGACY-GUILD-RING','212_admin_legacy_data_cleanup.sql'),
('ITEM-PENDANT-DRAW-TICKET','136_pendant_draw_open.sql'),
('ITEM-PENDANT-UNBIND-TICKET','137_pendant_equip.sql'),
('ITEM-RING-CHARM-REWARD','116_ring_reward_claim.sql'),
('ITEM-TERRITORY-AMBUSH-10','212_admin_legacy_data_cleanup.sql'),
('ITEM-TERRITORY-AMBUSH-40','212_admin_legacy_data_cleanup.sql'),
('ITEM-TERRITORY-ATTACK','212_admin_legacy_data_cleanup.sql'),
('ITEM-TERRITORY-DEFENSE-20','212_admin_legacy_data_cleanup.sql'),
('legacy-mini-pet-appearance-change-ticket','291_mini_pet_equipped_customize.sql'),
('legacy-mini-pet-name-change-ticket','291_mini_pet_equipped_customize.sql'),
('legacy-mini-pet-record-reset-ticket','294_mini_pet_battle_reset_ticket_craft.sql'),
('legacy-title-gift-ticket','235_player_title_gift.sql'),
('pet_skill_book','176_admin_pet_skill_book_grant.sql'),
('pet_skill_book_fragment','183_guild_pet_skill_stock_grant.sql'),
('pet_skill_carrot_thermometer','190_pet_skill_carrot_trade.sql'),
('pet_skill_extinction_ticket','188_pet_skill_extinction.sql'),
('punch_ticket','371_punch_action.sql'),
('territory_attack_ticket','353_guild_territory_attack_execute.sql'),
('territory_defense_ticket','353_guild_territory_attack_execute.sql'),
('trial_booster','154_common_trial_tower.sql'),
('trial_guide','154_common_trial_tower.sql'),
('trial_junk','154_common_trial_tower.sql'),
('trial_magic_stone','154_common_trial_tower.sql'),
('trial_reset_ticket','154_common_trial_tower.sql'),
('trial_tower_booster','248_mini_pet_battle_execute.sql');

UPDATE tmp_common_item_object_gap_401
SET frozen_only=1
WHERE definition_code IN ('ITEM-TERRITORY-AMBUSH-10','ITEM-TERRITORY-DEFENSE-20');

INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
('ITEM-TERRITORY-AMBUSH-10','영지기습공격권🔥(10%)','ITEM',1,
  JSON_OBJECT('source','212_admin_legacy_data_cleanup.sql','seedKind','DIRECT_SELECT',
    'inclusionReason','CONDITIONAL_DIRECT_SELECT_SEED_PREVIOUSLY_OMITTED',
    'membershipHash','cbf8ce772ac8b0f00ca3c35b8a85306a443e693efc3971aec9bb38da363ab816',
    'seededByMigration','401_common_item_object_gap_link.sql',
    'catalogVersion','ASSET-FREEZE-v2.400-common-item-object-gap-01'),1,1),
('ITEM-TERRITORY-DEFENSE-20','영지절대방어권🛡(20%)','ITEM',1,
  JSON_OBJECT('source','212_admin_legacy_data_cleanup.sql','seedKind','DIRECT_SELECT',
    'inclusionReason','CONDITIONAL_DIRECT_SELECT_SEED_PREVIOUSLY_OMITTED',
    'membershipHash','cbf8ce772ac8b0f00ca3c35b8a85306a443e693efc3971aec9bb38da363ab816',
    'seededByMigration','401_common_item_object_gap_link.sql',
    'catalogVersion','ASSET-FREEZE-v2.400-common-item-object-gap-01'),1,1)
ON DUPLICATE KEY UPDATE code=VALUES(code);

INSERT INTO object_registry (object_key, object_type, display_name, version, active, metadata_json)
SELECT CONCAT('item.common.', LOWER(gap_row.definition_code)), 'ITEM', definition_row.display_name,
  definition_row.version, definition_row.active,
  JSON_OBJECT(
    'domain', 'common_item_definition',
    'definitionCode', gap_row.definition_code,
    'definitionTarget', CONCAT('item_definitions|', gap_row.definition_code),
    'ownershipModel', IF(definition_row.stackable=1, 'STACK', 'INSTANCE'),
    'sourceIdentity', CONCAT('RUNTIME_DB|item_definitions|', gap_row.definition_code),
    'sourceMigration', gap_row.source_migration,
    'membershipHash', 'cbf8ce772ac8b0f00ca3c35b8a85306a443e693efc3971aec9bb38da363ab816',
    'catalogVersion', 'ASSET-FREEZE-v2.400-common-item-object-gap-01'
  )
FROM tmp_common_item_object_gap_401 gap_row
JOIN item_definitions definition_row ON definition_row.code=gap_row.definition_code
ON DUPLICATE KEY UPDATE object_key=VALUES(object_key);

INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT object_row.id, 'ITEM', 'item_code', gap_row.definition_code
FROM tmp_common_item_object_gap_401 gap_row
JOIN object_registry object_row ON object_row.object_key=CONCAT('item.common.', LOWER(gap_row.definition_code)) AND object_row.object_type='ITEM'
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id);

INSERT INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT object_row.id, 'ITEM', 'RUNTIME_DB', 'item_definitions', gap_row.definition_code
FROM tmp_common_item_object_gap_401 gap_row
JOIN object_registry object_row ON object_row.object_key=CONCAT('item.common.', LOWER(gap_row.definition_code)) AND object_row.object_type='ITEM'
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id);

DROP TEMPORARY TABLE tmp_common_item_object_gap_401;
COMMIT;
