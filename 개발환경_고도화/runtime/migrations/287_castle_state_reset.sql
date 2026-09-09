START TRANSACTION;

ALTER TABLE castle_state
  ADD COLUMN defense_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER earnings;

CREATE TABLE castle_state_reset_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  state_code VARCHAR(64) NOT NULL,
  previous_lord_player_id BIGINT UNSIGNED NULL,
  previous_lord_guild_name VARCHAR(191) NULL,
  previous_tax_rate_basis_points INT UNSIGNED NOT NULL,
  previous_earnings DECIMAL(30,0) NOT NULL,
  previous_defense_count BIGINT UNSIGNED NOT NULL,
  previous_version BIGINT UNSIGNED NOT NULL,
  reset_lord_player_id BIGINT UNSIGNED NOT NULL,
  reset_tax_rate_basis_points INT UNSIGNED NOT NULL,
  reset_earnings DECIMAL(30,0) NOT NULL,
  reset_defense_count BIGINT UNSIGNED NOT NULL,
  reset_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_castle_state_reset_operation(operation_id),
  KEY ix_castle_state_reset_state(state_code,created_at),
  CONSTRAINT fk_castle_state_reset_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_state_reset_operator FOREIGN KEY(actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_state_reset_state FOREIGN KEY(state_code) REFERENCES castle_state(state_code) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_state_reset_previous_lord FOREIGN KEY(previous_lord_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_castle_state_reset_lord FOREIGN KEY(reset_lord_player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_castle_state_reset_tax CHECK(reset_tax_rate_basis_points<=10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('CASTLE_STATE_RESET','castle_state_reset','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/캐슬초기화','CASTLE_STATE_RESET',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
