CREATE TABLE IF NOT EXISTS support_premium_notice_policies (
  policy_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  premium_pass_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  max_message_length INT UNSIGNED NOT NULL,
  free_daily_count INT UNSIGNED NOT NULL,
  item_daily_count INT UNSIGNED NOT NULL,
  consume_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rollout_state ENUM('SHADOW','CANARY','LIVE') NOT NULL DEFAULT 'SHADOW',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_premium_notice_daily_usage (
  player_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  premium_count INT UNSIGNED NOT NULL DEFAULT 0,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id, usage_date),
  CONSTRAINT fk_support_notice_usage_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_premium_notice_executions (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  usage_mode ENUM('NONE','PREMIUM_FREE','ITEM') NOT NULL,
  result_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  premium_count_before INT UNSIGNED NULL,
  premium_count_after INT UNSIGNED NULL,
  item_count_before INT UNSIGNED NULL,
  item_count_after INT UNSIGNED NULL,
  consume_item_id BIGINT UNSIGNED NULL,
  inventory_before BIGINT UNSIGNED NULL,
  inventory_after BIGINT UNSIGNED NULL,
  message_length INT UNSIGNED NULL,
  outbox_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY ix_support_notice_player_date (player_id, usage_date, created_at),
  CONSTRAINT fk_support_notice_execution_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_notice_execution_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_notice_execution_item FOREIGN KEY (consume_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_notice_execution_outbox FOREIGN KEY (outbox_id) REFERENCES outbox_messages(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('ITEM-RWD-005','확성기📢(/알림 내용 30자)','STACK',TRUE,JSON_OBJECT('sourceContract','v2.400','legacyBagKey','확성기📢(/알림 내용 30자)'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,active=TRUE,version=version+1;

INSERT INTO support_premium_notice_policies(policy_key,premium_pass_code,max_message_length,free_daily_count,item_daily_count,consume_item_code,rollout_state,enabled,version)
VALUES('v2.400','premium',40,3,2,'ITEM-RWD-005','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE premium_pass_code=VALUES(premium_pass_code),max_message_length=VALUES(max_message_length),free_daily_count=VALUES(free_daily_count),item_daily_count=VALUES(item_daily_count),consume_item_code=VALUES(consume_item_code),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('SUPPORT_PREMIUM_NOTICE_SEND','support_premium_notice_send','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/알림','SUPPORT_PREMIUM_NOTICE_SEND',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
