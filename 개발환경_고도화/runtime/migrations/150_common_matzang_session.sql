START TRANSACTION;
ALTER TABLE matzang_fields ADD COLUMN IF NOT EXISTS started_at DATETIME(3) NULL, ADD COLUMN IF NOT EXISTS ended_at DATETIME(3) NULL, ADD COLUMN IF NOT EXISTS version BIGINT UNSIGNED NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS matzang_rank_rewards (
  operation_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(64) NOT NULL,
  rank_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  pt BIGINT UNSIGNED NOT NULL,
  diamond_reward BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id,rank_no), UNIQUE KEY uq_matzang_rank_reward_player(operation_id,player_id),
  CONSTRAINT fk_matzang_rank_reward_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_matzang_rank_reward_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
COMMIT;
