ALTER TABLE foundation_states
  ADD COLUMN fee_rate DECIMAL(5,2) UNSIGNED NOT NULL DEFAULT 20.00 AFTER total_amount;

CREATE TABLE foundation_transfer_policies (
  foundation_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  minimum_fee_rate DECIMAL(5,2) UNSIGNED NOT NULL,
  maximum_fee_rate DECIMAL(5,2) UNSIGNED NOT NULL,
  fee_rate_step DECIMAL(5,2) UNSIGNED NOT NULL,
  member_fee_multiplier DECIMAL(5,4) UNSIGNED NOT NULL,
  membership_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  maximum_transfer_amount DECIMAL(30,3) UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (foundation_code),
  CONSTRAINT fk_foundation_transfer_policy_state FOREIGN KEY (foundation_code) REFERENCES foundation_states(foundation_code) ON DELETE RESTRICT,
  CONSTRAINT chk_foundation_transfer_fee_range CHECK (minimum_fee_rate <= maximum_fee_rate),
  CONSTRAINT chk_foundation_transfer_fee_step CHECK (fee_rate_step > 0),
  CONSTRAINT chk_foundation_transfer_member_multiplier CHECK (member_fee_multiplier <= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE foundation_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  foundation_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_player_id BIGINT UNSIGNED NOT NULL,
  recipient_player_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(30,3) UNSIGNED NOT NULL,
  fee_rate DECIMAL(5,2) UNSIGNED NOT NULL,
  fee_amount DECIMAL(30,3) UNSIGNED NOT NULL,
  member_fee_applied BOOLEAN NOT NULL,
  sender_balance_before DECIMAL(30,3) NOT NULL,
  sender_balance_after DECIMAL(30,3) NOT NULL,
  recipient_balance_before DECIMAL(30,3) NOT NULL,
  recipient_balance_after DECIMAL(30,3) NOT NULL,
  foundation_total_before DECIMAL(30,3) NOT NULL,
  foundation_total_after DECIMAL(30,3) NOT NULL,
  foundation_version_before BIGINT UNSIGNED NOT NULL,
  foundation_version_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_foundation_transfer_operation (operation_id),
  KEY ix_foundation_transfer_sender_created (sender_player_id,created_at,id),
  KEY ix_foundation_transfer_recipient_created (recipient_player_id,created_at,id),
  CONSTRAINT fk_foundation_transfer_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_foundation_transfer_state FOREIGN KEY (foundation_code) REFERENCES foundation_states(foundation_code) ON DELETE RESTRICT,
  CONSTRAINT fk_foundation_transfer_sender FOREIGN KEY (sender_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_foundation_transfer_recipient FOREIGN KEY (recipient_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_foundation_transfer_positive CHECK (amount > 0),
  CONSTRAINT chk_foundation_transfer_distinct_players CHECK (sender_player_id <> recipient_player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES ('HAPPY_FOUNDATION_MEMBERSHIP','호이행복재단 회원권','inventory_stack',TRUE,JSON_OBJECT('domain','happy_foundation','benefit','half_transfer_fee'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

INSERT INTO foundation_transfer_policies(foundation_code,minimum_fee_rate,maximum_fee_rate,fee_rate_step,member_fee_multiplier,membership_item_code,maximum_transfer_amount,version)
VALUES ('happy',0.00,100.00,0.01,0.5000,'HAPPY_FOUNDATION_MEMBERSHIP',9007199254740991,1)
ON DUPLICATE KEY UPDATE minimum_fee_rate=VALUES(minimum_fee_rate),maximum_fee_rate=VALUES(maximum_fee_rate),fee_rate_step=VALUES(fee_rate_step),member_fee_multiplier=VALUES(member_fee_multiplier),membership_item_code=VALUES(membership_item_code),maximum_transfer_amount=VALUES(maximum_transfer_amount),version=version+1;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('HAPPY_FOUNDATION_FEE_CHANGE','happy_foundation','VERIFIED_USER','SHADOW',TRUE,1),
  ('HAPPY_FOUNDATION_READ','happy_foundation','VERIFIED_USER','SHADOW',TRUE,1),
  ('POINT_TRANSFER','happy_foundation','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

UPDATE command_registry SET handler_key='happy_foundation',version=version+1 WHERE command_code='HAPPY_FOUNDATION_CAPTAIN_CHANGE';

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/이체수수료변경','HAPPY_FOUNDATION_FEE_CHANGE',TRUE),
  ('/이체수수료변경 [수수료율]','HAPPY_FOUNDATION_FEE_CHANGE',TRUE),
  ('/호이행복재단','HAPPY_FOUNDATION_READ',TRUE),
  ('/이체','POINT_TRANSFER',TRUE),
  ('/이체 [유저] [숫자]','POINT_TRANSFER',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
