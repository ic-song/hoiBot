START TRANSACTION;

INSERT INTO item_definitions(code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
  ('ITEM-RWD-CASTLE-BEGINNER', '캐슬초급유닛💂(+1💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_0','charmPerUnit',1,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-INTERMEDIATE', '캐슬중급유닛🥷🏼(+10💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_1','charmPerUnit',10,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-ADVANCED', '캐슬고급유닛🧙🏼‍♂(+50💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_2','charmPerUnit',50,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-UNIQUE', '캐슬유니크유닛👑(+200💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_3','charmPerUnit',200,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-RARE', '캐슬레어유닛⭐(+100💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_4','charmPerUnit',100,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-HERO', '캐슬영웅유닛💠(+300💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_5','charmPerUnit',300,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-LEGEND', '캐슬전설유닛🧝🏻‍♀(+500💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_6','charmPerUnit',500,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-MYTH', '캐슬신화유닛🧚🏻‍♀(+1000💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_7','charmPerUnit',1000,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-IMMORTAL', '캐슬불멸유닛🐉(+1500💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_8','charmPerUnit',1500,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-RWD-CASTLE-PHOENIX', '캐슬불사조유닛🐦‍🔥(+6000💕)', 'STACK', 1, JSON_OBJECT('objectType','castle_unit','sourceKey','item_9','charmPerUnit',6000,'sourceHash','329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3','catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), stackable=1,
  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),VALUES(metadata_json)), active=1;

INSERT INTO object_registry(object_key, object_type, display_name, version, active, metadata_json) VALUES
  ('item.castle.unit-item-0','ITEM','캐슬초급유닛💂(+1💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-0','sourceKey','item_0','displayOrder',1,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-1','ITEM','캐슬중급유닛🥷🏼(+10💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-1','sourceKey','item_1','displayOrder',2,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-2','ITEM','캐슬고급유닛🧙🏼‍♂(+50💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-2','sourceKey','item_2','displayOrder',3,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-3','ITEM','캐슬유니크유닛👑(+200💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-3','sourceKey','item_3','displayOrder',4,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-4','ITEM','캐슬레어유닛⭐(+100💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-4','sourceKey','item_4','displayOrder',5,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-5','ITEM','캐슬영웅유닛💠(+300💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-5','sourceKey','item_5','displayOrder',6,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-6','ITEM','캐슬전설유닛🧝🏻‍♀(+500💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-6','sourceKey','item_6','displayOrder',7,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-7','ITEM','캐슬신화유닛🧚🏻‍♀(+1000💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-7','sourceKey','item_7','displayOrder',8,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-8','ITEM','캐슬불멸유닛🐉(+1500💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-8','sourceKey','item_8','displayOrder',9,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.castle.unit-item-9','ITEM','캐슬불사조유닛🐦‍🔥(+6000💕)',1,1,JSON_OBJECT('domain','castle','unitCode','CASTLE-UNIT-ITEM-9','sourceKey','item_9','displayOrder',10,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'))
ON DUPLICATE KEY UPDATE object_type='ITEM',display_name=VALUES(display_name),active=1,metadata_json=VALUES(metadata_json);

INSERT INTO object_aliases(object_id, object_type, alias_type, alias_value)
SELECT registry.id, 'ITEM', 'item_code', seed.item_code
FROM (
  SELECT 'item.castle.unit-item-0' object_key, 'ITEM-RWD-CASTLE-BEGINNER' item_code
  UNION ALL SELECT 'item.castle.unit-item-1','ITEM-RWD-CASTLE-INTERMEDIATE'
  UNION ALL SELECT 'item.castle.unit-item-2','ITEM-RWD-CASTLE-ADVANCED'
  UNION ALL SELECT 'item.castle.unit-item-3','ITEM-RWD-CASTLE-UNIQUE'
  UNION ALL SELECT 'item.castle.unit-item-4','ITEM-RWD-CASTLE-RARE'
  UNION ALL SELECT 'item.castle.unit-item-5','ITEM-RWD-CASTLE-HERO'
  UNION ALL SELECT 'item.castle.unit-item-6','ITEM-RWD-CASTLE-LEGEND'
  UNION ALL SELECT 'item.castle.unit-item-7','ITEM-RWD-CASTLE-MYTH'
  UNION ALL SELECT 'item.castle.unit-item-8','ITEM-RWD-CASTLE-IMMORTAL'
  UNION ALL SELECT 'item.castle.unit-item-9','ITEM-RWD-CASTLE-PHOENIX'
) seed JOIN object_registry registry ON registry.object_key=seed.object_key
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type='ITEM';

INSERT INTO object_source_bindings(object_id, object_type, source_system, source_table, source_key)
SELECT registry.id, 'ITEM', 'legacy-json', 'data/itemInfo.json#castleItem', seed.source_key
FROM (
  SELECT 'item.castle.unit-item-0' object_key, 'item_0' source_key
  UNION ALL SELECT 'item.castle.unit-item-1','item_1'
  UNION ALL SELECT 'item.castle.unit-item-2','item_2'
  UNION ALL SELECT 'item.castle.unit-item-3','item_3'
  UNION ALL SELECT 'item.castle.unit-item-4','item_4'
  UNION ALL SELECT 'item.castle.unit-item-5','item_5'
  UNION ALL SELECT 'item.castle.unit-item-6','item_6'
  UNION ALL SELECT 'item.castle.unit-item-7','item_7'
  UNION ALL SELECT 'item.castle.unit-item-8','item_8'
  UNION ALL SELECT 'item.castle.unit-item-9','item_9'
) seed JOIN object_registry registry ON registry.object_key=seed.object_key
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type='ITEM';

INSERT INTO castle_battle_item_bonus_definitions(item_id, charm_per_unit, active, version)
SELECT item.id, seed.charm_per_unit, 1, 1
FROM (
  SELECT 'ITEM-RWD-CASTLE-BEGINNER' item_code, 1 charm_per_unit
  UNION ALL SELECT 'ITEM-RWD-CASTLE-INTERMEDIATE',10
  UNION ALL SELECT 'ITEM-RWD-CASTLE-ADVANCED',50
  UNION ALL SELECT 'ITEM-RWD-CASTLE-UNIQUE',200
  UNION ALL SELECT 'ITEM-RWD-CASTLE-RARE',100
  UNION ALL SELECT 'ITEM-RWD-CASTLE-HERO',300
  UNION ALL SELECT 'ITEM-RWD-CASTLE-LEGEND',500
  UNION ALL SELECT 'ITEM-RWD-CASTLE-MYTH',1000
  UNION ALL SELECT 'ITEM-RWD-CASTLE-IMMORTAL',1500
  UNION ALL SELECT 'ITEM-RWD-CASTLE-PHOENIX',6000
) seed JOIN item_definitions item ON item.code=seed.item_code
ON DUPLICATE KEY UPDATE charm_per_unit=VALUES(charm_per_unit),active=1;

COMMIT;
