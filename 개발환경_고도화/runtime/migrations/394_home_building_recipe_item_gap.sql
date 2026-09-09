START TRANSACTION;

UPDATE item_definitions
SET display_name='돌멩이🪨',asset_type_code='STACK',stackable=TRUE,active=TRUE,
  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),JSON_OBJECT('homeRecipeCatalogVersion','ASSET-FREEZE-v2.400-a286279b-01'))
WHERE code='ITEM-RWD-041';

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-RING-UPGRADE-STONE','반지 강화석💍','STACK',TRUE,JSON_OBJECT('domain','home_building_recipe','homeRecipeCatalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='STACK',stackable=TRUE,active=TRUE,
  metadata_json=JSON_MERGE_PATCH(COALESCE(item_definitions.metadata_json,JSON_OBJECT()),VALUES(metadata_json));

UPDATE item_definitions
SET active=TRUE,metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),JSON_OBJECT('homeRecipeCatalogVersion','ASSET-FREEZE-v2.400-a286279b-01'))
WHERE code IN ('castle_coin','ITEM-RWD-052');

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES
('item.home_material.stone','ITEM','돌멩이🪨',1,TRUE,JSON_EXTRACT('{"domain":"home_building_recipe","definitionCode":"ITEM-RWD-041","ownershipModel":"STACK","homeRecipe":{"occurrenceCount":300,"minCount":1000,"maxCount":300000,"uniqueCounts":[1000,1500,2000,3000,4000,5000,6000,7000,8000,9000,10000,11000,20000,30000,35000,40000,50000,80000,100000,120000,200000,250000,300000]},"otherConsumers":{"trialTowerRewardRows":88,"castleBattleRewardRows":0,"itemListNonItems":true,"itemListUntradable":true},"consumerCorrectionDependency":null,"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01"}','$')),
('item.ring.upgrade_stone','ITEM','반지 강화석💍',1,TRUE,JSON_EXTRACT('{"domain":"home_building_recipe","definitionCode":"ITEM-RING-UPGRADE-STONE","ownershipModel":"STACK","homeRecipe":{"occurrenceCount":300,"minCount":50,"maxCount":100,"uniqueCounts":[50,60,70,100]},"otherConsumers":{"trialTowerRewardRows":1,"castleBattleRewardRows":0,"itemListNonItems":true,"itemListUntradable":false},"consumerCorrectionDependency":null,"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01"}','$')),
('item.castle.coin','ITEM','캐슬코인🥇',1,TRUE,JSON_EXTRACT('{"domain":"home_building_recipe","definitionCode":"castle_coin","ownershipModel":"STACK","homeRecipe":{"occurrenceCount":300,"minCount":10,"maxCount":100,"uniqueCounts":[10,20,30,40,60,100]},"otherConsumers":{"trialTowerRewardRows":1,"castleBattleRewardRows":24,"itemListNonItems":true,"itemListUntradable":false},"consumerCorrectionDependency":null,"catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01"}','$')),
('item.material.legendary_stone','ITEM','전설의 돌맹이🗿',1,TRUE,JSON_EXTRACT('{"domain":"home_building_recipe","definitionCode":"ITEM-RWD-052","ownershipModel":"STACK","homeRecipe":{"occurrenceCount":251,"minCount":3,"maxCount":8,"uniqueCounts":[3,5,7,8]},"otherConsumers":{"trialTowerRewardRows":1,"castleBattleRewardRows":0,"itemListNonItems":true,"itemListUntradable":false},"consumerCorrectionDependency":"inventory.open_all:legendary_stone->ITEM-RWD-052","catalogVersion":"ASSET-FREEZE-v2.400-a286279b-01"}','$'))
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE,metadata_json=VALUES(metadata_json);

INSERT IGNORE INTO object_aliases(object_id,object_type,alias_type,alias_value)
SELECT id,object_type,'legacy_name','돌멩이🪨' FROM object_registry WHERE object_key='item.home_material.stone'
UNION ALL
SELECT id,object_type,'legacy_name','반지 강화석💍' FROM object_registry WHERE object_key='item.ring.upgrade_stone'
UNION ALL
SELECT id,object_type,'legacy_name','캐슬코인🥇' FROM object_registry WHERE object_key='item.castle.coin'
UNION ALL
SELECT id,object_type,'legacy_name','전설의 돌맹이🗿' FROM object_registry WHERE object_key='item.material.legendary_stone';

INSERT IGNORE INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT id,object_type,'RUNTIME_DB','item_definitions','ITEM-RWD-041' FROM object_registry WHERE object_key='item.home_material.stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','petSweetHomeInfo.homeInfo.required','돌멩이🪨' FROM object_registry WHERE object_key='item.home_material.stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','trialTowerBoss.reward','돌멩이🪨' FROM object_registry WHERE object_key='item.home_material.stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','itemList.nonItems','돌멩이🪨' FROM object_registry WHERE object_key='item.home_material.stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','itemList.untradableList','돌멩이🪨' FROM object_registry WHERE object_key='item.home_material.stone'
UNION ALL
SELECT id,object_type,'RUNTIME_DB','item_definitions','ITEM-RING-UPGRADE-STONE' FROM object_registry WHERE object_key='item.ring.upgrade_stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','petSweetHomeInfo.homeInfo.required','반지 강화석💍' FROM object_registry WHERE object_key='item.ring.upgrade_stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','trialTowerBoss.reward','반지 강화석💍' FROM object_registry WHERE object_key='item.ring.upgrade_stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','itemList.nonItems','반지 강화석💍' FROM object_registry WHERE object_key='item.ring.upgrade_stone'
UNION ALL
SELECT id,object_type,'RUNTIME_DB','item_definitions','castle_coin' FROM object_registry WHERE object_key='item.castle.coin'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','petSweetHomeInfo.homeInfo.required','캐슬코인🥇' FROM object_registry WHERE object_key='item.castle.coin'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','trialTowerBoss.reward','캐슬코인🥇' FROM object_registry WHERE object_key='item.castle.coin'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','castleBattle2.rank.rewards.items','캐슬코인🥇' FROM object_registry WHERE object_key='item.castle.coin'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','itemList.nonItems','캐슬코인🥇' FROM object_registry WHERE object_key='item.castle.coin'
UNION ALL
SELECT id,object_type,'RUNTIME_DB','item_definitions','ITEM-RWD-052' FROM object_registry WHERE object_key='item.material.legendary_stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','petSweetHomeInfo.homeInfo.required','전설의 돌맹이🗿' FROM object_registry WHERE object_key='item.material.legendary_stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','trialTowerBoss.reward','전설의 돌맹이🗿' FROM object_registry WHERE object_key='item.material.legendary_stone'
UNION ALL
SELECT id,object_type,'LEGACY_JSON','itemList.nonItems','전설의 돌맹이🗿' FROM object_registry WHERE object_key='item.material.legendary_stone';

INSERT INTO item_sale_policies(item_id,sellable,unit_price,source_code,row_version)
SELECT id,FALSE,0.000,'home-recipe-item-gap-v1',1 FROM item_definitions WHERE code='ITEM-RWD-041'
UNION ALL
SELECT id,FALSE,0.000,'home-recipe-item-gap-v1',1 FROM item_definitions WHERE code='ITEM-RING-UPGRADE-STONE'
UNION ALL
SELECT id,FALSE,0.000,'home-recipe-item-gap-v1',1 FROM item_definitions WHERE code='castle_coin'
UNION ALL
SELECT id,FALSE,0.000,'home-recipe-item-gap-v1',1 FROM item_definitions WHERE code='ITEM-RWD-052'
ON DUPLICATE KEY UPDATE sellable=FALSE,source_code=VALUES(source_code),row_version=item_sale_policies.row_version;

COMMIT;
