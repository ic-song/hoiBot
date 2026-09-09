CREATE TABLE IF NOT EXISTS carrot_board_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_player_id BIGINT UNSIGNED NULL,
  author_name_snapshot VARCHAR(191) NOT NULL,
  body TEXT NOT NULL,
  legacy_date VARCHAR(32) NOT NULL,
  source_order BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carrot_board_source_order (source_order),
  KEY idx_carrot_board_status_order (status, source_order),
  CONSTRAINT fk_carrot_board_author FOREIGN KEY (author_player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MARKET_CARROT_BOARD_READ','carrot_board_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/당근게시판','MARKET_CARROT_BOARD_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
