START TRANSACTION;

ALTER TABLE player_pet_intimacy
  ADD KEY idx_player_pet_intimacy_rank (intimacy_level DESC, charm DESC, player_pet_id);

CREATE TABLE pet_intimacy_ranking_state (
  state_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  top_player_id BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (state_key),
  CONSTRAINT fk_pet_intimacy_ranking_top_player FOREIGN KEY (top_player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_INTIMACY_RANK_READ','pet_intimacy_rank_read','TRUSTED_DISPLAY_NAME','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/펫친밀도순위','PET_INTIMACY_RANK_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
