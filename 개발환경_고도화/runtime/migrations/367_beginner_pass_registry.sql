START TRANSACTION;

INSERT INTO support_pass_definitions(pass_code,display_name,active)
VALUES('beginner','초보패스',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT 'ITEM-AUTO-EXPLORE-TICKET','자동탐험권🌄','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','자동탐험권🌄','stableObjectKey',TRUE),TRUE,1
FROM DUAL
WHERE NOT EXISTS(SELECT 1 FROM item_definitions WHERE display_name='자동탐험권🌄');

CREATE TABLE IF NOT EXISTS beginner_pass_policy (
  policy_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pass_code VARCHAR(64) NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  grant_quantity BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY(policy_key),
  CONSTRAINT fk_beginner_pass_policy_pass FOREIGN KEY(pass_code) REFERENCES support_pass_definitions(pass_code) ON DELETE RESTRICT,
  CONSTRAINT fk_beginner_pass_policy_item FOREIGN KEY(ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO beginner_pass_policy(policy_key,pass_code,ticket_item_id,grant_quantity,active,version)
SELECT 'default','beginner',definition.id,1,TRUE,1
FROM item_definitions definition
WHERE definition.display_name='자동탐험권🌄'
ORDER BY CASE WHEN definition.code='ITEM-AUTO-EXPLORE-TICKET' THEN 0 ELSE 1 END,definition.id
LIMIT 1
ON DUPLICATE KEY UPDATE pass_code=VALUES(pass_code),ticket_item_id=VALUES(ticket_item_id),grant_quantity=VALUES(grant_quantity),active=TRUE,version=beginner_pass_policy.version+1;

CREATE TABLE IF NOT EXISTS beginner_pass_auto_explore_compatibility (
  pass_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(pass_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO beginner_pass_auto_explore_compatibility(pass_code,active)
VALUES('hoi',TRUE),('support',TRUE),('premium',TRUE)
ON DUPLICATE KEY UPDATE active=TRUE;

CREATE TABLE IF NOT EXISTS beginner_pass_registry_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  pass_id BIGINT UNSIGNED NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  action_code ENUM('add','delete') NOT NULL,
  pass_changed BOOLEAN NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  ticket_delta BIGINT NOT NULL,
  ticket_balance_after BIGINT UNSIGNED NOT NULL,
  other_auto_pass_count BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_beginner_pass_event_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_beginner_pass_event_pass FOREIGN KEY(pass_id) REFERENCES player_support_passes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_beginner_pass_event_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_beginner_pass_event_item FOREIGN KEY(ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('BEGINNER_PASS_REGISTRY','beginner_pass_registry','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/초보추가','BEGINNER_PASS_REGISTRY',TRUE),('/초보삭제','BEGINNER_PASS_REGISTRY',TRUE),('/초보패스추가','BEGINNER_PASS_REGISTRY',TRUE),('/초보패스삭제','BEGINNER_PASS_REGISTRY',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
