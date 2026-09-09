START TRANSACTION;

INSERT INTO item_definitions (code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-DUNGEON-CHICKEN-BOX','양계장던전박스🐓(/양계장박스오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyItemCode','chicken_dungeon_box','gate8Snapshot','pending'),TRUE,1),
('ITEM-DUNGEON-SHOP-OPEN-BOX','샵오픈던전박스🏡(/샵오픈박스오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyItemCode','shop_open_dungeon_box','gate8Snapshot','pending'),TRUE,1),
('ITEM-PACKAGE-CHICKEN-BOX','치킨상자🐔','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyItemCode','chicken_box'),TRUE,1),
('ITEM-RWD-001','펫스윗홈인테리어샵🖼️(/샵오픈)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyItemCode','pet_home_shop_open'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=VALUES(stackable),active=VALUES(active);

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('INVENTORY_CHICKEN_DUNGEON_BOX_OPEN','inventory_fixed_reward_box_open','VERIFIED_USER','SHADOW',1,1),
('INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN','inventory_fixed_reward_box_open','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases (command_text,command_code,active) VALUES
('/양계장박스오픈','INVENTORY_CHICKEN_DUNGEON_BOX_OPEN',1),
('/샵오픈박스오픈','INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

CREATE TABLE IF NOT EXISTS fixed_reward_box_rules (
  command_code VARCHAR(96) NOT NULL,
  source_item_code VARCHAR(96) NOT NULL,
  reward_item_code VARCHAR(96) NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (command_code),
  CONSTRAINT fk_fixed_reward_box_rule_command FOREIGN KEY (command_code) REFERENCES command_registry (command_code) ON DELETE RESTRICT,
  CONSTRAINT chk_fixed_reward_box_rule_quantity CHECK (reward_quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO fixed_reward_box_rules (command_code,source_item_code,reward_item_code,reward_quantity,active,version) VALUES
('INVENTORY_CHICKEN_DUNGEON_BOX_OPEN','ITEM-DUNGEON-CHICKEN-BOX','ITEM-PACKAGE-CHICKEN-BOX',10,TRUE,1),
('INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN','ITEM-DUNGEON-SHOP-OPEN-BOX','ITEM-RWD-001',70,TRUE,1)
ON DUPLICATE KEY UPDATE source_item_code=VALUES(source_item_code),reward_item_code=VALUES(reward_item_code),reward_quantity=VALUES(reward_quantity),active=VALUES(active),version=version+1;

COMMIT;
