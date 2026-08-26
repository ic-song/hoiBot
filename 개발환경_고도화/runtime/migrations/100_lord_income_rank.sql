CREATE TABLE player_lord_earnings (
    player_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(30,0) NOT NULL DEFAULT 0,
    version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
    PRIMARY KEY (player_id),
    KEY idx_player_lord_earnings_rank (amount, player_id),
    CONSTRAINT fk_player_lord_earnings_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lord_income_reset_mutations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operation_id BIGINT UNSIGNED NOT NULL,
    affected_player_count BIGINT UNSIGNED NOT NULL,
    total_before DECIMAL(30,0) NOT NULL,
    result_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_lord_income_reset_operation (operation_id),
    CONSTRAINT fk_lord_income_reset_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry (command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
    ('LORD_INCOME_RANK_READ','LORD_INCOME_RANK_READ','TRUSTED_DISPLAY_NAME','SHADOW',1,1),
    ('ADMIN_LORD_INCOME_RESET','ADMIN_LORD_INCOME_RESET','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;
