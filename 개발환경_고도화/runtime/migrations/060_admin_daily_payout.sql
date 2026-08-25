CREATE TABLE admin_daily_payout_policies (
  policy_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payout_amount DECIMAL(30,3) NOT NULL,
  display_amount DECIMAL(30,3) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (policy_code, version),
  CONSTRAINT ck_admin_daily_payout_policy_amount CHECK (payout_amount > 0 AND display_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_daily_payout_operators (
  operator_id BIGINT UNSIGNED NOT NULL,
  legacy_display_name VARCHAR(191) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operator_id),
  CONSTRAINT fk_daily_payout_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_daily_payout_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  policy_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_version BIGINT UNSIGNED NOT NULL,
  payout_amount DECIMAL(30,3) NOT NULL,
  display_amount DECIMAL(30,3) NOT NULL,
  recipient_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_daily_payout_operation (operation_id),
  CONSTRAINT fk_daily_payout_execution_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_payout_execution_operator FOREIGN KEY (operator_id) REFERENCES admin_operators (id) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_payout_execution_policy FOREIGN KEY (policy_code, policy_version) REFERENCES admin_daily_payout_policies (policy_code, version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_daily_payout_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  execution_id BIGINT UNSIGNED NOT NULL,
  recipient_operator_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  balance_before DECIMAL(30,3) NOT NULL,
  amount DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_daily_payout_recipient (execution_id, player_id),
  CONSTRAINT fk_daily_payout_grant_execution FOREIGN KEY (execution_id) REFERENCES admin_daily_payout_executions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_payout_grant_operator FOREIGN KEY (recipient_operator_id) REFERENCES admin_operators (id) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_payout_grant_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT,
  CONSTRAINT ck_admin_daily_payout_grant_amount CHECK (amount > 0 AND balance_after = balance_before + amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_daily_payout_policies (policy_code, payout_amount, display_amount, active, version)
VALUES ('legacy-admin-daily-v1', 1000000000, 1000000000, TRUE, 1)
ON DUPLICATE KEY UPDATE payout_amount = VALUES(payout_amount), display_amount = VALUES(display_amount), active = TRUE;
