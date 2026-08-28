START TRANSACTION;

CREATE TABLE IF NOT EXISTS castle_battle_item_bonus_definitions (
  item_id BIGINT UNSIGNED NOT NULL,
  charm_per_unit BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (item_id),
  CONSTRAINT fk_castle_battle_item_bonus_item FOREIGN KEY (item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('CASTLE_BATTLE_SELF_RECORD_READ','castle_battle_self_record_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/캐슬전적','CASTLE_BATTLE_SELF_RECORD_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
