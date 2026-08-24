-- 패키지 실행의 소유권, 멱등성, 대상 조회를 강화합니다.
START TRANSACTION;

ALTER TABLE package_reward_rules
  ADD COLUMN IF NOT EXISTS owner_scope ENUM('USER', 'GUILD', 'TARGET_PET') NOT NULL DEFAULT 'USER' AFTER operation;

UPDATE package_reward_rules r
JOIN item_definitions i ON i.item_id = r.item_id
SET r.owner_scope = CASE
  WHEN i.item_type = 'GUILD_RESOURCE' THEN 'GUILD'
  WHEN i.item_type IN ('PET_TITLE', 'PET_APPEARANCE') THEN 'TARGET_PET'
  ELSE r.owner_scope
END;

UPDATE package_reward_rules r
JOIN item_definitions i ON i.item_id = r.item_id
SET r.target_selector = 'REQUESTED_PET'
WHERE i.item_type IN ('PET_TITLE', 'PET_APPEARANCE');

UPDATE package_reward_rules
SET owner_scope = 'TARGET_PET', target_selector = 'REQUESTED_PET'
WHERE operation = 'REPLACE';

ALTER TABLE package_reward_rules
  ADD CONSTRAINT ck_package_reward_rule_replace_scope CHECK (
    (operation <> 'REPLACE') OR (owner_scope = 'TARGET_PET' AND target_selector = 'REQUESTED_PET')
  );

ALTER TABLE package_use_operations
  ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64) NULL AFTER request_key;

CREATE INDEX IF NOT EXISTS ix_package_use_request_status
  ON package_use_operations(request_key, status);

CREATE INDEX IF NOT EXISTS ix_item_instance_target_active
  ON item_instances(owner_type, owner_id, target_instance_id, removed_at);

ALTER TABLE item_instances
  ADD CONSTRAINT fk_item_instance_target
  FOREIGN KEY (target_instance_id) REFERENCES item_instances(instance_id);

CREATE INDEX IF NOT EXISTS ix_package_reward_owner_scope
  ON package_reward_rules(package_id, owner_scope, enabled);

COMMIT;
