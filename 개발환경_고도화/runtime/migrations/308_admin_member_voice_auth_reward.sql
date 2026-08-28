CREATE TABLE IF NOT EXISTS player_verifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id BIGINT UNSIGNED NOT NULL,
  verification_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'verified',
  verified_by_operator_id BIGINT UNSIGNED NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  verified_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_verification_kind (player_id,verification_code),
  UNIQUE KEY uq_player_verification_operation (operation_id),
  CONSTRAINT chk_player_verification_status CHECK (status IN ('verified','revoked')),
  CONSTRAINT fk_player_verification_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_verification_operator FOREIGN KEY (verified_by_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_verification_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_member_voice_auth_reward_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  operator_player_id BIGINT UNSIGNED NOT NULL,
  target_player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_quantity BIGINT UNSIGNED NOT NULL,
  point_quantity DECIMAL(30,0) UNSIGNED NOT NULL,
  check_count_delta BIGINT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_member_voice_auth_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_member_voice_auth_operator FOREIGN KEY (operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_member_voice_auth_operator_player FOREIGN KEY (operator_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_member_voice_auth_target FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_member_voice_auth_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_member_voice_auth_result CHECK (JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO currency_definitions(code,display_name,scale_digits,active)
VALUES ('POINT','포인트',0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES ('ITEM-RWD-001','펫스윗홈인테리어샵🖼️(/샵오픈)','ITEM',TRUE,
  JSON_OBJECT('source','legacy-main.js','legacyField','bag.shop','sourceCommand','/인증','rewardQuantity',20),TRUE,1)
ON DUPLICATE KEY UPDATE active=TRUE,version=version+1;

INSERT INTO admin_permissions(code,display_name)
VALUES ('player.voice_verification.grant','회원 음성 인증 및 관리자 보상')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'player.voice_verification.grant' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_MEMBER_VOICE_AUTH_REWARD','admin_member_voice_auth_reward','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/인증','ADMIN_MEMBER_VOICE_AUTH_REWARD',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
