CREATE TABLE package_reward_rules (
  rule_id VARCHAR(128) NOT NULL,
  package_id VARCHAR(128) NOT NULL,
  reward_order INT NOT NULL,
  group_code VARCHAR(128) NOT NULL DEFAULT 'ALL',
  rule_mode ENUM('ALL', 'WEIGHTED_ONE', 'UNIFORM_RANGE', 'DYNAMIC_ITEM') NOT NULL,
  operation ENUM('ADD', 'REMOVE', 'REPLACE', 'NONE', 'BY_SIGN') NOT NULL DEFAULT 'ADD',
  owner_scope ENUM('USER', 'GUILD', 'TARGET_PET') NOT NULL DEFAULT 'USER',
  item_id VARCHAR(128) NULL,
  quantity BIGINT NOT NULL DEFAULT 1,
  weight DECIMAL(20, 10) NULL,
  range_min BIGINT NULL,
  range_max BIGINT NULL,
  range_step BIGINT NULL,
  target_selector VARCHAR(255) NULL,
  metadata_override_json JSON NULL,
  selector_json JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (rule_id),
  UNIQUE KEY uq_package_reward_rule_order (package_id, reward_order, rule_id),
  KEY ix_package_reward_rule_group (package_id, group_code, rule_mode, enabled),
  KEY ix_package_reward_rule_item (item_id),
  CONSTRAINT fk_package_reward_rule_package FOREIGN KEY (package_id) REFERENCES package_catalog(package_id),
  CONSTRAINT fk_package_reward_rule_item FOREIGN KEY (item_id) REFERENCES package_item_definitions(item_id),
  CONSTRAINT ck_package_reward_rule_quantity CHECK (quantity >= 0),
  CONSTRAINT ck_package_reward_rule_weight CHECK (weight IS NULL OR weight > 0),
  CONSTRAINT ck_package_reward_rule_range CHECK (
    (rule_mode <> 'UNIFORM_RANGE') OR
    (range_min IS NOT NULL AND range_max IS NOT NULL AND range_step IS NOT NULL AND range_step > 0 AND range_max >= range_min)
  ),
  CONSTRAINT ck_package_reward_rule_item_required CHECK (
    (operation = 'NONE') OR (rule_mode = 'DYNAMIC_ITEM') OR (item_id IS NOT NULL)
  ),
  CONSTRAINT ck_package_reward_rule_selector CHECK (
    (rule_mode <> 'DYNAMIC_ITEM') OR (selector_json IS NOT NULL)
  ),
  CONSTRAINT ck_package_reward_rule_replace CHECK (
    (operation <> 'REPLACE') OR (owner_scope = 'TARGET_PET' AND target_selector = 'REQUESTED_PET')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

