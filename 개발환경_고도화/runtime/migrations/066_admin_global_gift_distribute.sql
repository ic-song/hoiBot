INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('package_hoi_support_free_2','호이응원패키지(무료)🐹[2]','legacy_bag_item',TRUE,
  JSON_OBJECT('legacyName','호이응원패키지(무료)🐹[2]','packageCatalogCode','package_hoi_support_free_2'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),
  stackable=VALUES(stackable),metadata_json=VALUES(metadata_json),active=VALUES(active);

INSERT INTO package_definitions(code,display_name,price_currency_code,price_amount,purchase_limit,starts_at,ends_at,active)
VALUES('package_hoi_support_free_2','호이응원패키지(무료)🐹[2]',NULL,NULL,NULL,NULL,NULL,FALSE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

CREATE TABLE global_gift_definitions(
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  announcement_text VARCHAR(1000) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY(code),
  CONSTRAINT fk_global_gift_item FOREIGN KEY(item_code) REFERENCES item_definitions(code) ON DELETE RESTRICT,
  CONSTRAINT ck_global_gift_quantity CHECK(quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE global_gift_broadcast_channels(
  gift_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_room_code INT UNSIGNED NOT NULL,
  delivery_order TINYINT UNSIGNED NOT NULL,
  external_channel_id VARCHAR(191) NOT NULL,
  approved_by_operator_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  approved_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(gift_code,legacy_room_code),
  UNIQUE KEY uq_global_gift_delivery_order(gift_code,delivery_order),
  CONSTRAINT fk_global_gift_channel_definition FOREIGN KEY(gift_code) REFERENCES global_gift_definitions(code) ON DELETE RESTRICT,
  CONSTRAINT fk_global_gift_channel_operator FOREIGN KEY(approved_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT ck_global_gift_channel_status CHECK(status IN('active','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE global_gift_recipients(
  operation_id BIGINT UNSIGNED NOT NULL,
  recipient_ordinal INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity_before BIGINT UNSIGNED NOT NULL,
  quantity_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id,recipient_ordinal),
  UNIQUE KEY uq_global_gift_operation_player(operation_id,player_id),
  CONSTRAINT fk_global_gift_recipient_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_global_gift_recipient_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_global_gift_recipient_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO global_gift_definitions(code,item_code,quantity,announcement_text,active,version)
VALUES('hoi_support_free_2','package_hoi_support_free_2',1,'🎁 호이응원패키지(무료)🐹[2] 선물이 도착했습니다!',TRUE,1)
ON DUPLICATE KEY UPDATE item_code=VALUES(item_code),quantity=VALUES(quantity),announcement_text=VALUES(announcement_text),active=VALUES(active);

INSERT INTO admin_permissions(code,display_name)VALUES('inventory.global-gift.distribute','전체 회원 무료 선물 지급')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'inventory.global-gift.distribute' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);
