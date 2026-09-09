START TRANSACTION;

CREATE TABLE castle_battle_reset_all_runs (
  request_key VARCHAR(191) NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  player_count BIGINT UNSIGNED NOT NULL,
  state_rows_reset BIGINT UNSIGNED NOT NULL,
  daily_rows_reset BIGINT UNSIGNED NOT NULL,
  ticket_stacks_reset BIGINT UNSIGNED NOT NULL,
  ticket_quantity_removed BIGINT UNSIGNED NOT NULL,
  before_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  after_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(request_key),
  UNIQUE KEY uq_castle_battle_reset_all_operation(operation_id),
  CONSTRAINT fk_castle_battle_reset_all_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_reset_all_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_reset_all_season FOREIGN KEY(season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT chk_castle_battle_reset_all_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE castle_battle_reset_all_player_changes (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  previous_score BIGINT NULL,
  previous_win_count BIGINT UNSIGNED NULL,
  previous_loss_count BIGINT UNSIGNED NULL,
  previous_tier_point INT UNSIGNED NULL,
  previous_last_battle_at DATETIME(3) NULL,
  previous_daily_attempts BIGINT UNSIGNED NULL,
  previous_daily_score BIGINT NULL,
  previous_rank_label VARCHAR(191) NULL,
  ticket_item_id BIGINT UNSIGNED NULL,
  previous_ticket_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY(operation_id,player_id),
  CONSTRAINT fk_castle_battle_reset_change_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_reset_change_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_reset_change_season FOREIGN KEY(season_id) REFERENCES castle_battle_seasons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_battle_reset_change_item FOREIGN KEY(ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_CASTLE_BATTLE_RESET_ALL','castle_battle_reset_all','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/캐슬대전초기화','ADMIN_CASTLE_BATTLE_RESET_ALL',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
