START TRANSACTION;

CREATE TABLE guild_territory_ticket_definitions (
  ticket_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_id BIGINT UNSIGNED NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ITEM',
  item_id BIGINT UNSIGNED NOT NULL,
  scope_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_item_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  display_rate_percent TINYINT UNSIGNED NOT NULL,
  success_rate DECIMAL(8,6) UNSIGNED NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (ticket_code),
  UNIQUE KEY uq_territory_ticket_object (object_id),
  UNIQUE KEY uq_territory_ticket_item (item_id),
  UNIQUE KEY uq_territory_ticket_source (scope_code, source_item_key),
  UNIQUE KEY uq_territory_ticket_order (display_order),
  KEY fk_territory_ticket_object (object_id, object_type),
  CONSTRAINT fk_territory_ticket_object FOREIGN KEY (object_id, object_type) REFERENCES object_registry(id, object_type) ON DELETE RESTRICT,
  CONSTRAINT fk_territory_ticket_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_territory_ticket_type CHECK (object_type = 'ITEM'),
  CONSTRAINT chk_territory_ticket_scope CHECK (scope_code IN ('offense', 'defense')),
  CONSTRAINT chk_territory_ticket_display_rate CHECK (display_rate_percent BETWEEN 1 AND 100),
  CONSTRAINT chk_territory_ticket_success_rate CHECK (success_rate BETWEEN 0 AND 1),
  CONSTRAINT chk_territory_ticket_order CHECK (display_order > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
  ('ITEM-TERRITORY-AMBUSH-90', '영지기습공격권🔥(90%)', 'ITEM', 1, JSON_OBJECT('objectType','territory_ticket','scope','offense','sourceKey','item_0','displayRatePercent',90,'successRate',1.000000,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-TERRITORY-AMBUSH-60', '영지기습공격권🔥(60%)', 'ITEM', 1, JSON_OBJECT('objectType','territory_ticket','scope','offense','sourceKey','item_1','displayRatePercent',60,'successRate',0.600000,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-TERRITORY-AMBUSH-20', '영지기습공격권🔥(20%)', 'ITEM', 1, JSON_OBJECT('objectType','territory_ticket','scope','offense','sourceKey','item_2','displayRatePercent',20,'successRate',0.200000,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-TERRITORY-DEFENSE-80', '영지절대방어권🛡(80%)', 'ITEM', 1, JSON_OBJECT('objectType','territory_ticket','scope','defense','sourceKey','item_0','displayRatePercent',80,'successRate',1.000000,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-TERRITORY-DEFENSE-50', '영지절대방어권🛡(50%)', 'ITEM', 1, JSON_OBJECT('objectType','territory_ticket','scope','defense','sourceKey','item_1','displayRatePercent',50,'successRate',0.500000,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1),
  ('ITEM-TERRITORY-DEFENSE-25', '영지절대방어권🛡(25%)', 'ITEM', 1, JSON_OBJECT('objectType','territory_ticket','scope','defense','sourceKey','item_2','displayRatePercent',25,'successRate',0.250000,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'), 1, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  asset_type_code = 'ITEM',
  stackable = 1,
  metadata_json = JSON_MERGE_PATCH(COALESCE(metadata_json, JSON_OBJECT()), VALUES(metadata_json)),
  active = 1;

INSERT INTO object_registry(object_key, object_type, display_name, version, active, metadata_json) VALUES
  ('item.guild-territory.ticket-offense-item-0','ITEM','영지기습공격권🔥(90%)',1,1,JSON_OBJECT('domain','guild_territory','ticketCode','TERRITORY-TICKET-OFFENSE-ITEM-0','scope','offense','sourceKey','item_0','displayOrder',1,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.guild-territory.ticket-offense-item-1','ITEM','영지기습공격권🔥(60%)',1,1,JSON_OBJECT('domain','guild_territory','ticketCode','TERRITORY-TICKET-OFFENSE-ITEM-1','scope','offense','sourceKey','item_1','displayOrder',2,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.guild-territory.ticket-offense-item-2','ITEM','영지기습공격권🔥(20%)',1,1,JSON_OBJECT('domain','guild_territory','ticketCode','TERRITORY-TICKET-OFFENSE-ITEM-2','scope','offense','sourceKey','item_2','displayOrder',3,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.guild-territory.ticket-defense-item-0','ITEM','영지절대방어권🛡(80%)',1,1,JSON_OBJECT('domain','guild_territory','ticketCode','TERRITORY-TICKET-DEFENSE-ITEM-0','scope','defense','sourceKey','item_0','displayOrder',4,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.guild-territory.ticket-defense-item-1','ITEM','영지절대방어권🛡(50%)',1,1,JSON_OBJECT('domain','guild_territory','ticketCode','TERRITORY-TICKET-DEFENSE-ITEM-1','scope','defense','sourceKey','item_1','displayOrder',5,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
  ('item.guild-territory.ticket-defense-item-2','ITEM','영지절대방어권🛡(25%)',1,1,JSON_OBJECT('domain','guild_territory','ticketCode','TERRITORY-TICKET-DEFENSE-ITEM-2','scope','defense','sourceKey','item_2','displayOrder',6,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'))
ON DUPLICATE KEY UPDATE object_type='ITEM', display_name=VALUES(display_name), active=1, metadata_json=VALUES(metadata_json);

INSERT INTO object_source_bindings(object_id, object_type, source_system, source_table, source_key)
SELECT registry.id, 'ITEM', 'legacy-json', 'data/itemInfo.json#castlePremiumItem', seed.source_key
FROM (
  SELECT 'item.guild-territory.ticket-offense-item-0' object_key, 'offense/item_0' source_key
  UNION ALL SELECT 'item.guild-territory.ticket-offense-item-1', 'offense/item_1'
  UNION ALL SELECT 'item.guild-territory.ticket-offense-item-2', 'offense/item_2'
  UNION ALL SELECT 'item.guild-territory.ticket-defense-item-0', 'defense/item_0'
  UNION ALL SELECT 'item.guild-territory.ticket-defense-item-1', 'defense/item_1'
  UNION ALL SELECT 'item.guild-territory.ticket-defense-item-2', 'defense/item_2'
) seed
JOIN object_registry registry ON registry.object_key = seed.object_key
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id), object_type='ITEM';

INSERT INTO guild_territory_ticket_definitions(ticket_code, object_id, object_type, item_id, scope_code, source_item_key, display_name, display_rate_percent, success_rate, display_order, source_hash, catalog_version, active) VALUES
  ('TERRITORY-TICKET-OFFENSE-ITEM-0',(SELECT id FROM object_registry WHERE object_key='item.guild-territory.ticket-offense-item-0'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-TERRITORY-AMBUSH-90'),'offense','item_0','영지기습공격권🔥(90%)',90,1.000000,1,'b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a','ASSET-FREEZE-v2.400-a286279b-01',1),
  ('TERRITORY-TICKET-OFFENSE-ITEM-1',(SELECT id FROM object_registry WHERE object_key='item.guild-territory.ticket-offense-item-1'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-TERRITORY-AMBUSH-60'),'offense','item_1','영지기습공격권🔥(60%)',60,0.600000,2,'b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a','ASSET-FREEZE-v2.400-a286279b-01',1),
  ('TERRITORY-TICKET-OFFENSE-ITEM-2',(SELECT id FROM object_registry WHERE object_key='item.guild-territory.ticket-offense-item-2'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-TERRITORY-AMBUSH-20'),'offense','item_2','영지기습공격권🔥(20%)',20,0.200000,3,'b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a','ASSET-FREEZE-v2.400-a286279b-01',1),
  ('TERRITORY-TICKET-DEFENSE-ITEM-0',(SELECT id FROM object_registry WHERE object_key='item.guild-territory.ticket-defense-item-0'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-TERRITORY-DEFENSE-80'),'defense','item_0','영지절대방어권🛡(80%)',80,1.000000,4,'b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a','ASSET-FREEZE-v2.400-a286279b-01',1),
  ('TERRITORY-TICKET-DEFENSE-ITEM-1',(SELECT id FROM object_registry WHERE object_key='item.guild-territory.ticket-defense-item-1'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-TERRITORY-DEFENSE-50'),'defense','item_1','영지절대방어권🛡(50%)',50,0.500000,5,'b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a','ASSET-FREEZE-v2.400-a286279b-01',1),
  ('TERRITORY-TICKET-DEFENSE-ITEM-2',(SELECT id FROM object_registry WHERE object_key='item.guild-territory.ticket-defense-item-2'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-TERRITORY-DEFENSE-25'),'defense','item_2','영지절대방어권🛡(25%)',25,0.250000,6,'b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a','ASSET-FREEZE-v2.400-a286279b-01',1)
ON DUPLICATE KEY UPDATE
  object_id=VALUES(object_id), object_type='ITEM', item_id=VALUES(item_id), scope_code=VALUES(scope_code),
  source_item_key=VALUES(source_item_key), display_name=VALUES(display_name), display_rate_percent=VALUES(display_rate_percent),
  success_rate=VALUES(success_rate), display_order=VALUES(display_order), source_hash=VALUES(source_hash),
  catalog_version=VALUES(catalog_version), active=1, updated_at=UTC_TIMESTAMP(3);

COMMIT;
