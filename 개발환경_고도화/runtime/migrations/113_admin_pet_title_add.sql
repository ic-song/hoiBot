START TRANSACTION;

CREATE TABLE IF NOT EXISTS player_pet_title_instances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instance_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  title_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name TEXT NOT NULL,
  price_digits TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_order BIGINT UNSIGNED NOT NULL,
  acquired_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owned',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_pet_title_instance_key (instance_key),
  UNIQUE KEY uq_player_pet_title_display_order (player_id, display_order),
  KEY idx_player_pet_title_key (player_id, title_key),
  CONSTRAINT fk_player_pet_title_instance_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_PET_TITLE_ADD','admin_pet_title_add','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫타이틀추가','ADMIN_PET_TITLE_ADD',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;

