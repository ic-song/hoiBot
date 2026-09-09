-- 동적 보상 카탈로그, 소유자별 인스턴스 용량, 선택 보상 번들을 정의합니다.
START TRANSACTION;

CREATE TABLE package_reward_bundle_items (
  bundle_item_id VARCHAR(128) NOT NULL,
  parent_rule_id VARCHAR(128) NOT NULL,
  reward_order INT NOT NULL,
  operation ENUM('ADD', 'REMOVE', 'REPLACE') NOT NULL DEFAULT 'ADD',
  owner_scope ENUM('USER', 'GUILD', 'TARGET_PET') NOT NULL DEFAULT 'USER',
  item_id VARCHAR(128) NOT NULL,
  quantity BIGINT NOT NULL,
  target_selector VARCHAR(255) NULL,
  metadata_override_json JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bundle_item_id),
  UNIQUE KEY uq_package_reward_bundle_order (parent_rule_id, reward_order, bundle_item_id),
  KEY ix_package_reward_bundle_item (item_id),
  CONSTRAINT fk_package_reward_bundle_rule FOREIGN KEY (parent_rule_id) REFERENCES package_reward_rules(rule_id),
  CONSTRAINT fk_package_reward_bundle_item FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id),
  CONSTRAINT ck_package_reward_bundle_quantity CHECK (quantity > 0),
  CONSTRAINT ck_package_reward_bundle_replace CHECK (
    (operation <> 'REPLACE') OR (owner_scope = 'TARGET_PET' AND target_selector = 'REQUESTED_PET')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dynamic_item_catalog_entries (
  catalog_code VARCHAR(128) NOT NULL,
  item_id VARCHAR(128) NOT NULL,
  grade_code VARCHAR(128) NOT NULL,
  grade_weight DECIMAL(20, 10) NOT NULL,
  item_weight DECIMAL(20, 10) NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (catalog_code, item_id),
  KEY ix_dynamic_catalog_grade (catalog_code, enabled, grade_code),
  CONSTRAINT fk_dynamic_catalog_item FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id),
  CONSTRAINT ck_dynamic_catalog_grade_weight CHECK (grade_weight > 0),
  CONSTRAINT ck_dynamic_catalog_item_weight CHECK (item_weight > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE owner_item_capacities (
  owner_type ENUM('USER', 'GUILD', 'PET') NOT NULL,
  owner_id VARCHAR(191) NOT NULL,
  item_type ENUM('STACK', 'POINT', 'PET', 'MINI_PET', 'FURNITURE', 'MEMBER_TITLE', 'PET_TITLE', 'PET_APPEARANCE', 'GUILD_RESOURCE') NOT NULL,
  capacity BIGINT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owner_type, owner_id, item_type),
  CONSTRAINT ck_owner_item_capacity CHECK (capacity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;

