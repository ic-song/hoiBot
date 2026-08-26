START TRANSACTION;

INSERT IGNORE INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-PENDANT-DRAW-TICKET','펜던트뽑기💎(/펜던트오픈)','PACKAGE_ITEM',1,JSON_OBJECT('objectType','pendant_draw_ticket','source','legacy-main.js'),1,1),
('ITEM-PENDANT-DRAW-QUIET','조용한 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','조용한 펜던트','icon','💎','grade','최하급','charm','200000','explore',0.3,'rate',39.89,'drawOrder',1,'gradeOrder',13,'notice',false),1,1),
('ITEM-PENDANT-DRAW-OATH','맹세의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','맹세의 펜던트','icon','💎','grade','하급','charm','500000','explore',0.4,'rate',25,'drawOrder',2,'gradeOrder',12,'notice',false),1,1),
('ITEM-PENDANT-DRAW-RIFT','균열의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','균열의 펜던트','icon','💎','grade','하급+','charm','1000000','explore',0.5,'rate',15,'drawOrder',3,'gradeOrder',11,'notice',false),1,1),
('ITEM-PENDANT-DRAW-STORM','폭풍의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','폭풍의 펜던트','icon','💎','grade','중급','charm','2000000','explore',0.6,'rate',8,'drawOrder',4,'gradeOrder',10,'notice',false),1,1),
('ITEM-PENDANT-DRAW-CRUEL','잔혹의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','잔혹의 펜던트','icon','💎','grade','중급+','charm','3000000','explore',0.7,'rate',5,'drawOrder',5,'gradeOrder',9,'notice',false),1,1),
('ITEM-PENDANT-DRAW-STARS','별들의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','별들의 펜던트','icon','💎','grade','상급','charm','4000000','explore',0.9,'rate',3,'drawOrder',6,'gradeOrder',8,'notice',false),1,1),
('ITEM-PENDANT-DRAW-GREED','탐욕의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','탐욕의 펜던트','icon','💎','grade','상급+','charm','5000000','explore',1.0,'rate',2,'drawOrder',7,'gradeOrder',7,'notice',false),1,1),
('ITEM-PENDANT-DRAW-FATE','운명의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','운명의 펜던트','icon','💎','grade','최상급','charm','6000000','explore',1.1,'rate',1.2,'drawOrder',8,'gradeOrder',6,'notice',false),1,1),
('ITEM-PENDANT-DRAW-JUDGMENT','심판의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','심판의 펜던트','icon','💎','grade','최상급+','charm','7000000','explore',1.2,'rate',0.6,'drawOrder',9,'gradeOrder',5,'notice',true),1,1),
('ITEM-PENDANT-DRAW-THRONE','왕좌의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','왕좌의 펜던트','icon','💎','grade','신화','charm','8000000','explore',1.3,'rate',0.2,'drawOrder',10,'gradeOrder',4,'notice',true),1,1),
('ITEM-PENDANT-DRAW-SKY','하늘의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','하늘의 펜던트','icon','💎','grade','초월','charm','10000000','explore',1.5,'rate',0.08,'drawOrder',11,'gradeOrder',3,'notice',true),1,1),
('ITEM-PENDANT-DRAW-GENESIS','창세의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','창세의 펜던트','icon','💎','grade','창세','charm','15000000','explore',2.0,'rate',0.02,'drawOrder',12,'gradeOrder',2,'notice',true),1,1),
('ITEM-PENDANT-DRAW-CREATION','창조의 펜던트','PENDANT',0,JSON_OBJECT('objectType','pendant','name','창조의 펜던트','icon','💎','grade','창조','charm','20000000','explore',2.5,'rate',0.01,'drawOrder',13,'gradeOrder',1,'notice',true),1,1);

CREATE TABLE IF NOT EXISTS pendant_draw_results (
  operation_id BIGINT UNSIGNED NOT NULL,
  draw_ordinal INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  inventory_instance_id BIGINT UNSIGNED NOT NULL,
  sample_value DECIMAL(20,19) NOT NULL,
  rate_value DECIMAL(11,8) NOT NULL,
  grade_code VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id,draw_ordinal),
  UNIQUE KEY uq_pendant_draw_instance(inventory_instance_id),
  CONSTRAINT fk_pendant_draw_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_pendant_draw_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_pendant_draw_item FOREIGN KEY(item_id) REFERENCES item_definitions(id),
  CONSTRAINT fk_pendant_draw_instance FOREIGN KEY(inventory_instance_id) REFERENCES inventory_instances(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PENDANT_DRAW_OPEN','pendant_draw_open','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);
INSERT INTO command_aliases(command_text,command_code,active) VALUES('/펜던트오픈','PENDANT_DRAW_OPEN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
