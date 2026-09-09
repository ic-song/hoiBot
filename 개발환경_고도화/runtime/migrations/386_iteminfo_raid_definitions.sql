START TRANSACTION;
CREATE TABLE raid_item_bonus_definitions (
 bonus_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, object_id BIGINT UNSIGNED NOT NULL,
 object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ITEM', item_id BIGINT UNSIGNED NOT NULL,
 department_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, source_item_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 display_name VARCHAR(191) NOT NULL, raid_exp_bonus BIGINT UNSIGNED NOT NULL, display_order INT UNSIGNED NOT NULL,
 source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, catalog_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(bonus_code), UNIQUE KEY uq_raid_item_bonus_object(object_id), UNIQUE KEY uq_raid_item_bonus_item(item_id),
 UNIQUE KEY uq_raid_item_bonus_source(department_code,source_item_key), UNIQUE KEY uq_raid_item_bonus_order(display_order),
 KEY fk_raid_item_bonus_object(object_id,object_type),
 CONSTRAINT fk_raid_item_bonus_object FOREIGN KEY(object_id,object_type) REFERENCES object_registry(id,object_type) ON DELETE RESTRICT,
 CONSTRAINT fk_raid_item_bonus_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_raid_item_bonus_type CHECK(object_type='ITEM'), CONSTRAINT chk_raid_item_bonus_order CHECK(display_order>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-RAID-SPECIAL-DEPT1-001','항생제💊(+50👾)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_0','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-002','마늘🧄(+50🧛‍♂)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_1','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-003','거울🪞(+50🤬)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_2','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-004','에프킬라💦(+50🪳)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_3','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-005','도깨비가면👹(+50🧌)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_4','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-006','곰팡이🍄(+50🍄)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_5','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-007','트롤심장💓(+50🪅)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_6','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RAID-SPECIAL-DEPT1-008','하리보🪼(+50🌝)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept1','sourceKey','item_7','raidExpBonus',50,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RWD-043','레이드타격대인장👑(+600👾)','ITEM',1,JSON_OBJECT('objectType','raid_special_item','department','dept2','sourceKey','item_0','raidExpBonus',600,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='ITEM',stackable=1,
metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)),active=1;
INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES
('item.raid.special-dept1-item-0','ITEM','항생제💊(+50👾)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-0','department','dept1','sourceKey','item_0','displayOrder',1,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-1','ITEM','마늘🧄(+50🧛‍♂)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-1','department','dept1','sourceKey','item_1','displayOrder',2,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-2','ITEM','거울🪞(+50🤬)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-2','department','dept1','sourceKey','item_2','displayOrder',3,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-3','ITEM','에프킬라💦(+50🪳)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-3','department','dept1','sourceKey','item_3','displayOrder',4,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-4','ITEM','도깨비가면👹(+50🧌)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-4','department','dept1','sourceKey','item_4','displayOrder',5,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-5','ITEM','곰팡이🍄(+50🍄)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-5','department','dept1','sourceKey','item_5','displayOrder',6,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-6','ITEM','트롤심장💓(+50🪅)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-6','department','dept1','sourceKey','item_6','displayOrder',7,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept1-item-7','ITEM','하리보🪼(+50🌝)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT1-ITEM-7','department','dept1','sourceKey','item_7','displayOrder',8,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.raid.special-dept2-item-0','ITEM','레이드타격대인장👑(+600👾)',1,1,JSON_OBJECT('domain','raid','bonusCode','RAID-SPECIAL-DEPT2-ITEM-0','department','dept2','sourceKey','item_0','displayOrder',9,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'))
ON DUPLICATE KEY UPDATE object_type='ITEM',display_name=VALUES(display_name),active=1,metadata_json=VALUES(metadata_json);
INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT registry.id,'ITEM','legacy-json','data/itemInfo.json#raidSpecialItem',seed.source_key FROM (
 SELECT 'item.raid.special-dept1-item-0' object_key,'dept1/item_0' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-1' object_key,'dept1/item_1' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-2' object_key,'dept1/item_2' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-3' object_key,'dept1/item_3' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-4' object_key,'dept1/item_4' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-5' object_key,'dept1/item_5' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-6' object_key,'dept1/item_6' source_key
 UNION ALL
 SELECT 'item.raid.special-dept1-item-7' object_key,'dept1/item_7' source_key
 UNION ALL
 SELECT 'item.raid.special-dept2-item-0' object_key,'dept2/item_0' source_key
) seed JOIN object_registry registry ON registry.object_key=seed.object_key
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type='ITEM';
INSERT INTO raid_item_bonus_definitions(bonus_code,object_id,object_type,item_id,department_code,source_item_key,display_name,raid_exp_bonus,display_order,source_hash,catalog_version,active) VALUES
('RAID-SPECIAL-DEPT1-ITEM-0',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-0'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-001'),'dept1','item_0','항생제💊(+50👾)',50,1,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-1',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-1'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-002'),'dept1','item_1','마늘🧄(+50🧛‍♂)',50,2,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-2',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-2'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-003'),'dept1','item_2','거울🪞(+50🤬)',50,3,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-3',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-3'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-004'),'dept1','item_3','에프킬라💦(+50🪳)',50,4,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-4',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-4'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-005'),'dept1','item_4','도깨비가면👹(+50🧌)',50,5,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-5',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-5'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-006'),'dept1','item_5','곰팡이🍄(+50🍄)',50,6,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-6',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-6'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-007'),'dept1','item_6','트롤심장💓(+50🪅)',50,7,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT1-ITEM-7',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept1-item-7'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RAID-SPECIAL-DEPT1-008'),'dept1','item_7','하리보🪼(+50🌝)',50,8,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1),
('RAID-SPECIAL-DEPT2-ITEM-0',(SELECT id FROM object_registry WHERE object_key='item.raid.special-dept2-item-0'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RWD-043'),'dept2','item_0','레이드타격대인장👑(+600👾)',600,9,'d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259','ASSET-FREEZE-v2.400-a286279b-01',1)
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type='ITEM',item_id=VALUES(item_id),department_code=VALUES(department_code),
source_item_key=VALUES(source_item_key),display_name=VALUES(display_name),raid_exp_bonus=VALUES(raid_exp_bonus),display_order=VALUES(display_order),
source_hash=VALUES(source_hash),catalog_version=VALUES(catalog_version),active=1,updated_at=UTC_TIMESTAMP(3);
COMMIT;
