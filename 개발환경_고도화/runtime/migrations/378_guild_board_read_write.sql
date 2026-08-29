START TRANSACTION;

ALTER TABLE guild_board_posts
  ADD COLUMN IF NOT EXISTS author_display_name_snapshot VARCHAR(191) NULL AFTER author_player_id,
  ADD COLUMN IF NOT EXISTS version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER deleted_at;

CREATE TABLE IF NOT EXISTS guild_board_notices (
  guild_id BIGINT UNSIGNED NOT NULL,
  author_player_id BIGINT UNSIGNED NOT NULL,
  author_display_name_snapshot VARCHAR(191) NOT NULL,
  body VARCHAR(191) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id),
  CONSTRAINT fk_guild_board_notice_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_guild_board_notice_author FOREIGN KEY (author_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT chk_guild_board_notice_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 30)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('GUILD_BOARD_READ_WRITE','guild_board','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/길메','GUILD_BOARD_READ_WRITE',TRUE),
('/길드게시판','GUILD_BOARD_READ_WRITE',TRUE),
('/길드게시판공지','GUILD_BOARD_READ_WRITE',TRUE),
('/길드게시판초기화','GUILD_BOARD_READ_WRITE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
