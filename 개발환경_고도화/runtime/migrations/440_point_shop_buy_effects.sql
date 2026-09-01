ALTER TABLE point_shop_catalog
  ADD COLUMN reward_item_id BIGINT UNSIGNED NULL AFTER price,
  ADD COLUMN effect_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'STACK_ITEM' AFTER reward_item_id,
  ADD COLUMN effect_config_json JSON NOT NULL AFTER effect_type,
  ADD COLUMN max_quantity BIGINT UNSIGNED NULL AFTER effect_config_json,
  ADD COLUMN daily_limit BIGINT UNSIGNED NULL AFTER max_quantity,
  ADD CONSTRAINT fk_point_shop_catalog_reward_item FOREIGN KEY (reward_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_point_shop_catalog_effect_config CHECK (JSON_VALID(effect_config_json));

INSERT INTO point_shop_catalog
  (product_id,product_key,display_name,price,reward_item_id,effect_type,effect_config_json,max_quantity,daily_limit,display_order,catalog_version,enabled,row_version)
VALUES
  ('point-shop-tier-ticket','tier-promotion-ticket','티어 승급티켓🎟',5490000,(SELECT id FROM item_definitions WHERE code='ITEM-RWD-022'),'STACK_ITEM',JSON_OBJECT('itemCode','ITEM-RWD-022','bonusSkill','티어 상승론','bonusRateBasisPoints',100),NULL,NULL,1,1,1,1),
  ('point-shop-castle-coin','castle-coin','캐슬코인🥇',10000000,(SELECT id FROM item_definitions WHERE code='ITEM-RWD-042'),'STACK_ITEM',JSON_OBJECT('itemCode','ITEM-RWD-042'),NULL,NULL,2,1,1,1),
  ('point-shop-stone','stone','돌멩이🪨',139000,(SELECT id FROM item_definitions WHERE code='ITEM-RWD-041'),'STACK_ITEM',JSON_OBJECT('itemCode','ITEM-RWD-041'),NULL,NULL,3,1,1,1),
  ('point-shop-pet-personality','pet-personality','펫 성격 변경하기😣',1000000,NULL,'PET_PERSONALITY_RANDOM',JSON_OBJECT('policy','LEGACY_PET_PERSONALITIES'),1,NULL,4,1,1,1),
  ('point-shop-pet-appearance','pet-appearance','펫 외형 변경하기🌟',5000000,NULL,'PET_APPEARANCE_RANDOM',JSON_OBJECT('policy','STARTER_PET_APPEARANCE','limitedConfirmation',TRUE),2,NULL,5,1,1,1),
  ('point-shop-letter-stamp','letter-stamp','우표💌',100000,(SELECT id FROM item_definitions WHERE code='LETTER_STAMP'),'STACK_ITEM',JSON_OBJECT('itemCode','LETTER_STAMP'),NULL,NULL,6,1,1,1),
  ('point-shop-carrot','carrot','🥕당근이세요?',7500000,(SELECT id FROM item_definitions WHERE code='ITEM-RWD-044'),'STACK_ITEM',JSON_OBJECT('itemCode','ITEM-RWD-044','counterCode','point_shop_carrot_buy'),NULL,1000,7,1,1,1),
  ('point-shop-pet-element','pet-element','펫 속성리롤🔄',1000000,NULL,'PET_ELEMENT_RANDOM',JSON_OBJECT('policy','LEGACY_SKY_LAND_SEA'),1,NULL,8,1,1,1),
  ('point-shop-pet-skill-extinction','pet-skill-extinction','펫스킬소멸권🧙‍♂️(/펫스킬소멸 번호)',10000000000,(SELECT id FROM item_definitions WHERE code='pet_skill_extinction_ticket'),'STACK_ITEM',JSON_OBJECT('itemCode','pet_skill_extinction_ticket'),NULL,NULL,9,1,1,1)
ON DUPLICATE KEY UPDATE
  product_key=VALUES(product_key),display_name=VALUES(display_name),price=VALUES(price),reward_item_id=VALUES(reward_item_id),
  effect_type=VALUES(effect_type),effect_config_json=VALUES(effect_config_json),max_quantity=VALUES(max_quantity),daily_limit=VALUES(daily_limit),
  display_order=VALUES(display_order),enabled=TRUE,deleted_at=NULL,row_version=row_version+1;

CREATE TABLE point_shop_purchase_confirmations (
  player_id BIGINT UNSIGNED NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(player_id,product_id),
  CONSTRAINT fk_point_shop_confirmation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_point_shop_confirmation_product FOREIGN KEY(product_id) REFERENCES point_shop_catalog(product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE point_shop_purchase_events (
  operation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  product_id VARCHAR(64) NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  point_spent DECIMAL(30,3) NOT NULL,
  tax_amount DECIMAL(30,3) NOT NULL,
  point_balance_after DECIMAL(30,3) NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effect_result_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  CONSTRAINT fk_point_shop_purchase_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_point_shop_purchase_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_point_shop_purchase_product FOREIGN KEY(product_id) REFERENCES point_shop_catalog(product_id) ON DELETE RESTRICT,
  CONSTRAINT chk_point_shop_purchase_effect CHECK (effect_result_json IS NULL OR JSON_VALID(effect_result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('POINT_SHOP_BUY','POINT_SHOP_BUY','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/구매','POINT_SHOP_BUY',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

