CREATE TABLE home_comment_pin_mutations (
  request_key VARCHAR(191) NOT NULL PRIMARY KEY,
  operation_id BIGINT UNSIGNED NOT NULL UNIQUE,
  player_id BIGINT UNSIGNED NOT NULL,
  pin_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_id BIGINT UNSIGNED NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_home_comment_pin_mutation_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_comment_pin_mutation_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_home_comment_pin_mutation_comment FOREIGN KEY(comment_id) REFERENCES home_comments(id),
  CONSTRAINT chk_home_comment_pin_mutation_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('HOME_COMMENT_PIN','HOME_COMMENT_PIN','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/댓글핀','HOME_COMMENT_PIN',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);
