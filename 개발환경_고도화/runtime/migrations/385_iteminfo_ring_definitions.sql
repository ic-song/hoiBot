START TRANSACTION;
CREATE TABLE ring_grade_definitions (
  grade_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, object_id BIGINT UNSIGNED NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ITEM', item_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  grade_display_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  item_display_name VARCHAR(191) NOT NULL, grade_order INT UNSIGNED NOT NULL, emoji VARCHAR(64) NOT NULL, names_json JSON NOT NULL,
  success_rate DECIMAL(9,6) NOT NULL, drop_rate DECIMAL(9,6) NOT NULL, item_cost BIGINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL, max_level BIGINT UNSIGNED NOT NULL, battle_exp BIGINT UNSIGNED NOT NULL,
  battle_upgrade_exp BIGINT UNSIGNED NOT NULL, raid_exp BIGINT UNSIGNED NOT NULL, raid_upgrade_exp BIGINT UNSIGNED NOT NULL,
  castle_exp BIGINT UNSIGNED NOT NULL, castle_upgrade_exp BIGINT UNSIGNED NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (grade_code), UNIQUE KEY uq_ring_grade_object (object_id), UNIQUE KEY uq_ring_grade_item (item_id),
  UNIQUE KEY uq_ring_grade_source (source_key), UNIQUE KEY uq_ring_grade_order (grade_order),
  KEY fk_ring_grade_object (object_id, object_type),
  CONSTRAINT fk_ring_grade_object FOREIGN KEY (object_id, object_type) REFERENCES object_registry(id, object_type) ON DELETE RESTRICT,
  CONSTRAINT fk_ring_grade_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ring_grade_type CHECK (object_type = 'ITEM'),
  CONSTRAINT chk_ring_grade_success CHECK (success_rate >= 0 AND success_rate <= 1),
  CONSTRAINT chk_ring_grade_drop CHECK (drop_rate >= 0 AND drop_rate <= 1),
  CONSTRAINT chk_ring_grade_order CHECK (grade_order > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-RING-GRADE-001','테무 반지📎','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-001','sourceKey','최하급','gradeOrder',1,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-002','은 반지🪙','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-002','sourceKey','하급','gradeOrder',2,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-003','24K 반지⚜️','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-003','sourceKey','중급','gradeOrder',3,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-004','에메랄드 반지💠','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-004','sourceKey','고급','gradeOrder',4,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-005','다이아 반지💍','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-005','sourceKey','상급','gradeOrder',5,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-006','사파이어 반지🔮','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-006','sourceKey','최상급','gradeOrder',6,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-007','보라핑 반지🦄','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-007','sourceKey','서사급','gradeOrder',7,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-008','개새 반지🐶🐦','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-008','sourceKey','전설급','gradeOrder',8,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-009','킹찐따 반지🫥','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-009','sourceKey','신화급','gradeOrder',9,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-010','초월 반지🐻‍❄️','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-010','sourceKey','초월급','gradeOrder',10,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-011','절대 반지🐹','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-011','sourceKey','절대급','gradeOrder',11,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-012','회귀의 반지🧸','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-012','sourceKey','회귀급','gradeOrder',12,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-013','고귀의 반지👻','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-013','sourceKey','고귀급','gradeOrder',13,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-014','존엄의 반지🌖','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-014','sourceKey','존엄급','gradeOrder',14,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-015','신위의 반지👑','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-015','sourceKey','신위급','gradeOrder',15,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-016','성역의 반지🕊️','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-016','sourceKey','성역급','gradeOrder',16,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-017','창세의 반지🌍','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-017','sourceKey','창세급','gradeOrder',17,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-018','무극의 반지🌀','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-018','sourceKey','무극급','gradeOrder',18,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-019','영겁의 반지⏳','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-019','sourceKey','영겁급','gradeOrder',19,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-020','태초의 반지✨','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-020','sourceKey','태초급','gradeOrder',20,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-021','절정의 반지🔥','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-021','sourceKey','절정급','gradeOrder',21,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-022','초신의 반지🌠','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-022','sourceKey','초신급','gradeOrder',22,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-023','무한의 반지🔵','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-023','sourceKey','무한급','gradeOrder',23,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-024','심연의 반지🌑','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-024','sourceKey','심연급','gradeOrder',24,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-025','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-025','sourceKey','숨별빛10급','gradeOrder',25,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-026','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-026','sourceKey','숨별빛9급','gradeOrder',26,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-027','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-027','sourceKey','숨별빛8급','gradeOrder',27,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-028','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-028','sourceKey','숨별빛7급','gradeOrder',28,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-029','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-029','sourceKey','숨별빛6급','gradeOrder',29,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-030','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-030','sourceKey','숨별빛5급','gradeOrder',30,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-031','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-031','sourceKey','숨별빛4급','gradeOrder',31,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-032','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-032','sourceKey','숨별빛3급','gradeOrder',32,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-033','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-033','sourceKey','숨별빛2급','gradeOrder',33,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-034','숨빌볓 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-034','sourceKey','숨별빛1급','gradeOrder',34,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-035','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-035','sourceKey','숨은해빛10급','gradeOrder',35,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-036','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-036','sourceKey','숨은해빛9급','gradeOrder',36,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-037','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-037','sourceKey','숨은해빛8급','gradeOrder',37,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-038','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-038','sourceKey','숨은해빛7급','gradeOrder',38,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-039','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-039','sourceKey','숨은해빛6급','gradeOrder',39,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-040','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-040','sourceKey','숨은해빛5급','gradeOrder',40,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-041','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-041','sourceKey','숨은해빛4급','gradeOrder',41,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-042','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-042','sourceKey','숨은해빛3급','gradeOrder',42,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-043','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-043','sourceKey','숨은해빛2급','gradeOrder',43,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-044','숨은해빛 반지💫','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-044','sourceKey','숨은해빛1급','gradeOrder',44,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1),
('ITEM-RING-GRADE-045','언약💍','ITEM',0,JSON_OBJECT('objectType','ring','gradeCode','RING-GRADE-045','sourceKey','반지[10급]','gradeOrder',45,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'),1,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='ITEM',stackable=0,metadata_json=VALUES(metadata_json),active=1;
INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES
('item.ring.grade-001','ITEM','테무 반지📎',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-001','sourceKey','최하급','gradeOrder',1,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-002','ITEM','은 반지🪙',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-002','sourceKey','하급','gradeOrder',2,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-003','ITEM','24K 반지⚜️',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-003','sourceKey','중급','gradeOrder',3,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-004','ITEM','에메랄드 반지💠',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-004','sourceKey','고급','gradeOrder',4,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-005','ITEM','다이아 반지💍',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-005','sourceKey','상급','gradeOrder',5,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-006','ITEM','사파이어 반지🔮',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-006','sourceKey','최상급','gradeOrder',6,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-007','ITEM','보라핑 반지🦄',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-007','sourceKey','서사급','gradeOrder',7,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-008','ITEM','개새 반지🐶🐦',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-008','sourceKey','전설급','gradeOrder',8,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-009','ITEM','킹찐따 반지🫥',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-009','sourceKey','신화급','gradeOrder',9,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-010','ITEM','초월 반지🐻‍❄️',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-010','sourceKey','초월급','gradeOrder',10,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-011','ITEM','절대 반지🐹',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-011','sourceKey','절대급','gradeOrder',11,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-012','ITEM','회귀의 반지🧸',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-012','sourceKey','회귀급','gradeOrder',12,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-013','ITEM','고귀의 반지👻',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-013','sourceKey','고귀급','gradeOrder',13,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-014','ITEM','존엄의 반지🌖',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-014','sourceKey','존엄급','gradeOrder',14,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-015','ITEM','신위의 반지👑',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-015','sourceKey','신위급','gradeOrder',15,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-016','ITEM','성역의 반지🕊️',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-016','sourceKey','성역급','gradeOrder',16,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-017','ITEM','창세의 반지🌍',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-017','sourceKey','창세급','gradeOrder',17,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-018','ITEM','무극의 반지🌀',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-018','sourceKey','무극급','gradeOrder',18,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-019','ITEM','영겁의 반지⏳',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-019','sourceKey','영겁급','gradeOrder',19,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-020','ITEM','태초의 반지✨',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-020','sourceKey','태초급','gradeOrder',20,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-021','ITEM','절정의 반지🔥',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-021','sourceKey','절정급','gradeOrder',21,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-022','ITEM','초신의 반지🌠',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-022','sourceKey','초신급','gradeOrder',22,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-023','ITEM','무한의 반지🔵',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-023','sourceKey','무한급','gradeOrder',23,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-024','ITEM','심연의 반지🌑',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-024','sourceKey','심연급','gradeOrder',24,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-025','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-025','sourceKey','숨별빛10급','gradeOrder',25,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-026','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-026','sourceKey','숨별빛9급','gradeOrder',26,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-027','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-027','sourceKey','숨별빛8급','gradeOrder',27,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-028','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-028','sourceKey','숨별빛7급','gradeOrder',28,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-029','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-029','sourceKey','숨별빛6급','gradeOrder',29,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-030','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-030','sourceKey','숨별빛5급','gradeOrder',30,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-031','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-031','sourceKey','숨별빛4급','gradeOrder',31,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-032','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-032','sourceKey','숨별빛3급','gradeOrder',32,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-033','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-033','sourceKey','숨별빛2급','gradeOrder',33,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-034','ITEM','숨빌볓 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-034','sourceKey','숨별빛1급','gradeOrder',34,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-035','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-035','sourceKey','숨은해빛10급','gradeOrder',35,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-036','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-036','sourceKey','숨은해빛9급','gradeOrder',36,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-037','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-037','sourceKey','숨은해빛8급','gradeOrder',37,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-038','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-038','sourceKey','숨은해빛7급','gradeOrder',38,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-039','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-039','sourceKey','숨은해빛6급','gradeOrder',39,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-040','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-040','sourceKey','숨은해빛5급','gradeOrder',40,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-041','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-041','sourceKey','숨은해빛4급','gradeOrder',41,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-042','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-042','sourceKey','숨은해빛3급','gradeOrder',42,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-043','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-043','sourceKey','숨은해빛2급','gradeOrder',43,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-044','ITEM','숨은해빛 반지💫',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-044','sourceKey','숨은해빛1급','gradeOrder',44,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01')),
('item.ring.grade-045','ITEM','언약💍',1,1,JSON_OBJECT('domain','ring','gradeCode','RING-GRADE-045','sourceKey','반지[10급]','gradeOrder',45,'catalogVersion','ASSET-FREEZE-v2.400-a286279b-01'))
ON DUPLICATE KEY UPDATE object_type='ITEM',display_name=VALUES(display_name),active=1,metadata_json=VALUES(metadata_json);
INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT registry.id,'ITEM','legacy-json','data/itemInfo.json#ring',seed.source_key FROM (
  SELECT 'item.ring.grade-001' object_key,'최하급' source_key
  UNION ALL
  SELECT 'item.ring.grade-002' object_key,'하급' source_key
  UNION ALL
  SELECT 'item.ring.grade-003' object_key,'중급' source_key
  UNION ALL
  SELECT 'item.ring.grade-004' object_key,'고급' source_key
  UNION ALL
  SELECT 'item.ring.grade-005' object_key,'상급' source_key
  UNION ALL
  SELECT 'item.ring.grade-006' object_key,'최상급' source_key
  UNION ALL
  SELECT 'item.ring.grade-007' object_key,'서사급' source_key
  UNION ALL
  SELECT 'item.ring.grade-008' object_key,'전설급' source_key
  UNION ALL
  SELECT 'item.ring.grade-009' object_key,'신화급' source_key
  UNION ALL
  SELECT 'item.ring.grade-010' object_key,'초월급' source_key
  UNION ALL
  SELECT 'item.ring.grade-011' object_key,'절대급' source_key
  UNION ALL
  SELECT 'item.ring.grade-012' object_key,'회귀급' source_key
  UNION ALL
  SELECT 'item.ring.grade-013' object_key,'고귀급' source_key
  UNION ALL
  SELECT 'item.ring.grade-014' object_key,'존엄급' source_key
  UNION ALL
  SELECT 'item.ring.grade-015' object_key,'신위급' source_key
  UNION ALL
  SELECT 'item.ring.grade-016' object_key,'성역급' source_key
  UNION ALL
  SELECT 'item.ring.grade-017' object_key,'창세급' source_key
  UNION ALL
  SELECT 'item.ring.grade-018' object_key,'무극급' source_key
  UNION ALL
  SELECT 'item.ring.grade-019' object_key,'영겁급' source_key
  UNION ALL
  SELECT 'item.ring.grade-020' object_key,'태초급' source_key
  UNION ALL
  SELECT 'item.ring.grade-021' object_key,'절정급' source_key
  UNION ALL
  SELECT 'item.ring.grade-022' object_key,'초신급' source_key
  UNION ALL
  SELECT 'item.ring.grade-023' object_key,'무한급' source_key
  UNION ALL
  SELECT 'item.ring.grade-024' object_key,'심연급' source_key
  UNION ALL
  SELECT 'item.ring.grade-025' object_key,'숨별빛10급' source_key
  UNION ALL
  SELECT 'item.ring.grade-026' object_key,'숨별빛9급' source_key
  UNION ALL
  SELECT 'item.ring.grade-027' object_key,'숨별빛8급' source_key
  UNION ALL
  SELECT 'item.ring.grade-028' object_key,'숨별빛7급' source_key
  UNION ALL
  SELECT 'item.ring.grade-029' object_key,'숨별빛6급' source_key
  UNION ALL
  SELECT 'item.ring.grade-030' object_key,'숨별빛5급' source_key
  UNION ALL
  SELECT 'item.ring.grade-031' object_key,'숨별빛4급' source_key
  UNION ALL
  SELECT 'item.ring.grade-032' object_key,'숨별빛3급' source_key
  UNION ALL
  SELECT 'item.ring.grade-033' object_key,'숨별빛2급' source_key
  UNION ALL
  SELECT 'item.ring.grade-034' object_key,'숨별빛1급' source_key
  UNION ALL
  SELECT 'item.ring.grade-035' object_key,'숨은해빛10급' source_key
  UNION ALL
  SELECT 'item.ring.grade-036' object_key,'숨은해빛9급' source_key
  UNION ALL
  SELECT 'item.ring.grade-037' object_key,'숨은해빛8급' source_key
  UNION ALL
  SELECT 'item.ring.grade-038' object_key,'숨은해빛7급' source_key
  UNION ALL
  SELECT 'item.ring.grade-039' object_key,'숨은해빛6급' source_key
  UNION ALL
  SELECT 'item.ring.grade-040' object_key,'숨은해빛5급' source_key
  UNION ALL
  SELECT 'item.ring.grade-041' object_key,'숨은해빛4급' source_key
  UNION ALL
  SELECT 'item.ring.grade-042' object_key,'숨은해빛3급' source_key
  UNION ALL
  SELECT 'item.ring.grade-043' object_key,'숨은해빛2급' source_key
  UNION ALL
  SELECT 'item.ring.grade-044' object_key,'숨은해빛1급' source_key
  UNION ALL
  SELECT 'item.ring.grade-045' object_key,'반지[10급]' source_key
) seed JOIN object_registry registry ON registry.object_key=seed.object_key
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type='ITEM';
INSERT INTO ring_grade_definitions
(grade_code,object_id,object_type,item_id,source_key,grade_display_name,item_display_name,grade_order,emoji,names_json,success_rate,drop_rate,item_cost,point_cost,max_level,battle_exp,battle_upgrade_exp,raid_exp,raid_upgrade_exp,castle_exp,castle_upgrade_exp,source_hash,catalog_version,active) VALUES
('RING-GRADE-001',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-001'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-001'),'최하급','최하급','테무 반지📎',1,'🥉','["테무 반지📎"]',1,0,1,2500000,100,300,5,1000,20,300,5,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-002',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-002'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-002'),'하급','하급','은 반지🪙',2,'🥈','["은 반지🪙"]',1,0,2,5000000,100,800,10,3000,30,800,10,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-003',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-003'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-003'),'중급','중급','24K 반지⚜️',3,'🥇','["24K 반지⚜️"]',1,0,4,17500000,100,1800,10,6000,35,1800,10,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-004',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-004'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-004'),'고급','고급','에메랄드 반지💠',4,'💠','["에메랄드 반지💠"]',1,0,8,25000000,100,3000,15,10000,50,3000,15,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-005',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-005'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-005'),'상급','상급','다이아 반지💍',5,'💍','["다이아 반지💍"]',1,0,16,50000000,100,5000,30,15000,50,5000,30,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-006',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-006'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-006'),'최상급','최상급','사파이어 반지🔮',6,'🔮','["사파이어 반지🔮"]',0.8,0,20,50000000,100,10000,35,20000,70,10000,35,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-007',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-007'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-007'),'서사급','서사급','보라핑 반지🦄',7,'🦄','["보라핑 반지🦄"]',0.7,0,25,50000000,100,15000,40,27000,80,15000,40,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-008',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-008'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-008'),'전설급','전설급','개새 반지🐶🐦',8,'🐶','["개새 반지🐶🐦"]',0.7,0,30,50000000,100,20000,45,35000,100,20000,45,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-009',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-009'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-009'),'신화급','신화급','킹찐따 반지🫥',9,'🫥','["킹찐따 반지🫥"]',0.6,0,35,50000000,100,25000,80,45000,150,25000,80,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-010',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-010'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-010'),'초월급','초월급','초월 반지🐻‍❄️',10,'🐻‍❄️','["초월 반지🐻‍❄️"]',0.5,0,40,50000000,100,35000,100,60000,200,35000,100,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-011',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-011'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-011'),'절대급','절대급','절대 반지🐹',11,'🐹','["절대 반지🐹"]',0.5,0,50,50000000,100,50000,150,80000,250,50000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-012',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-012'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-012'),'회귀급','회귀급','회귀의 반지🧸',12,'🧸','["회귀의 반지🧸"]',0.5,0,50,50000000,100,65000,150,105000,250,65000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-013',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-013'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-013'),'고귀급','고귀급','고귀의 반지👻',13,'👻','["고귀의 반지👻"]',0.5,0,60,50000000,100,80000,150,130000,250,80000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-014',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-014'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-014'),'존엄급','존엄급','존엄의 반지🌖',14,'🌖','["존엄의 반지🌖"]',0.4,0,70,50000000,100,95000,150,155000,250,95000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-015',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-015'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-015'),'신위급','신위급','신위의 반지👑',15,'👑','["신위의 반지👑"]',0.4,0,80,50000000,100,110000,150,180000,250,110000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-016',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-016'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-016'),'성역급','성역급','성역의 반지🕊️',16,'🕊️','["성역의 반지🕊️"]',0.4,0,90,50000000,100,125000,150,205000,250,125000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-017',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-017'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-017'),'창세급','창세급','창세의 반지🌍',17,'🌍','["창세의 반지🌍"]',0.4,0,100,50000000,100,140000,150,230000,250,140000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-018',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-018'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-018'),'무극급','무극급','무극의 반지🌀',18,'🌀','["무극의 반지🌀"]',0.4,0,100,50000000,100,155000,150,255000,250,155000,150,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-019',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-019'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-019'),'영겁급','영겁급','영겁의 반지⏳',19,'⏳','["영겁의 반지⏳"]',0.4,0,100,50000000,100,170000,200,280000,200,170000,200,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-020',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-020'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-020'),'태초급','태초급','태초의 반지✨',20,'✨','["태초의 반지✨"]',0.4,0,100,50000000,100,190000,200,300000,200,190000,200,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-021',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-021'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-021'),'절정급','절정급','절정의 반지🔥',21,'🔥','["절정의 반지🔥"]',0.4,0,100,50000000,100,210000,200,320000,200,210000,200,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-022',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-022'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-022'),'초신급','초신급','초신의 반지🌠',22,'🌠','["초신의 반지🌠"]',0.4,0,100,50000000,100,230000,200,340000,200,230000,200,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-023',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-023'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-023'),'무한급','무한급','무한의 반지🔵',23,'🔵','["무한의 반지🔵"]',0.4,0,100,50000000,100,250000,200,360000,200,250000,200,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-024',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-024'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-024'),'심연급','심연급','심연의 반지🌑',24,'🌑','["심연의 반지🌑"]',0.4,0,100,50000000,100,270000,200,380000,200,270000,200,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-025',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-025'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-025'),'숨별빛10급','숨별빛10급','숨빌볓 반지💫',25,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,295000,250,390000,100,295000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-026',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-026'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-026'),'숨별빛9급','숨별빛9급','숨빌볓 반지💫',26,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,320000,250,400000,100,320000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-027',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-027'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-027'),'숨별빛8급','숨별빛8급','숨빌볓 반지💫',27,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,345000,250,410000,100,345000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-028',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-028'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-028'),'숨별빛7급','숨별빛7급','숨빌볓 반지💫',28,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,370000,250,420000,100,370000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-029',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-029'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-029'),'숨별빛6급','숨별빛6급','숨빌볓 반지💫',29,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,395000,250,430000,100,395000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-030',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-030'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-030'),'숨별빛5급','숨별빛5급','숨빌볓 반지💫',30,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,420000,250,440000,100,420000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-031',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-031'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-031'),'숨별빛4급','숨별빛4급','숨빌볓 반지💫',31,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,445000,250,450000,100,445000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-032',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-032'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-032'),'숨별빛3급','숨별빛3급','숨빌볓 반지💫',32,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,470000,250,460000,100,470000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-033',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-033'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-033'),'숨별빛2급','숨별빛2급','숨빌볓 반지💫',33,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,495000,250,470000,100,495000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-034',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-034'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-034'),'숨별빛1급','숨별빛1급','숨빌볓 반지💫',34,'🌑','["숨빌볓 반지💫"]',0.3,0,100,50000000,100,520000,250,480000,100,520000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-035',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-035'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-035'),'숨은해빛10급','숨은해빛10급','숨은해빛 반지💫',35,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,545000,250,490000,100,545000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-036',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-036'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-036'),'숨은해빛9급','숨은해빛9급','숨은해빛 반지💫',36,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,570000,250,500000,100,570000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-037',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-037'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-037'),'숨은해빛8급','숨은해빛8급','숨은해빛 반지💫',37,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,595000,250,510000,100,595000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-038',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-038'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-038'),'숨은해빛7급','숨은해빛7급','숨은해빛 반지💫',38,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,620000,250,520000,100,620000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-039',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-039'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-039'),'숨은해빛6급','숨은해빛6급','숨은해빛 반지💫',39,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,645000,250,530000,100,645000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-040',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-040'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-040'),'숨은해빛5급','숨은해빛5급','숨은해빛 반지💫',40,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,670000,250,540000,100,670000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-041',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-041'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-041'),'숨은해빛4급','숨은해빛4급','숨은해빛 반지💫',41,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,695000,250,550000,100,695000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-042',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-042'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-042'),'숨은해빛3급','숨은해빛3급','숨은해빛 반지💫',42,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,720000,250,560000,100,720000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-043',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-043'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-043'),'숨은해빛2급','숨은해빛2급','숨은해빛 반지💫',43,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,745000,250,570000,100,745000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-044',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-044'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-044'),'숨은해빛1급','숨은해빛1급','숨은해빛 반지💫',44,'🌑','["숨은해빛 반지💫"]',0.3,0,110,50000000,100,770000,250,580000,100,770000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1),
('RING-GRADE-045',(SELECT id FROM object_registry WHERE object_key='item.ring.grade-045'),'ITEM',(SELECT id FROM item_definitions WHERE code='ITEM-RING-GRADE-045'),'반지[10급]','반지[10급]','언약💍',45,'🌑','["언약💍"]',0.3,0,120,50000000,1000,795000,250,590000,100,795000,250,'b114073a714edc62236e95b4ab2a64ac27085e442dad979a0e023e0c8140abb7','ASSET-FREEZE-v2.400-a286279b-01',1)
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type='ITEM',item_id=VALUES(item_id),source_key=VALUES(source_key),
grade_display_name=VALUES(grade_display_name),item_display_name=VALUES(item_display_name),grade_order=VALUES(grade_order),
emoji=VALUES(emoji),names_json=VALUES(names_json),success_rate=VALUES(success_rate),drop_rate=VALUES(drop_rate),
item_cost=VALUES(item_cost),point_cost=VALUES(point_cost),max_level=VALUES(max_level),battle_exp=VALUES(battle_exp),
battle_upgrade_exp=VALUES(battle_upgrade_exp),raid_exp=VALUES(raid_exp),raid_upgrade_exp=VALUES(raid_upgrade_exp),
castle_exp=VALUES(castle_exp),castle_upgrade_exp=VALUES(castle_upgrade_exp),source_hash=VALUES(source_hash),
catalog_version=VALUES(catalog_version),active=1,updated_at=UTC_TIMESTAMP(3);
COMMIT;
