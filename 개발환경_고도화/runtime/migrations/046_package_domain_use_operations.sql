CREATE TABLE IF NOT EXISTS package_domain_uses (
    request_key VARCHAR(191) NOT NULL,
    operation_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    package_id VARCHAR(64) NOT NULL,
    requested_open_count INT UNSIGNED NOT NULL,
    committed_open_count INT UNSIGNED NULL,
    reward_count INT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL,
    result_json LONGTEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (request_key),
    UNIQUE KEY uq_package_domain_use_operation (operation_id),
    KEY ix_package_domain_use_player_created (player_id, created_at),
    CONSTRAINT fk_package_domain_use_operation
        FOREIGN KEY (operation_id) REFERENCES operations(id),
    CONSTRAINT fk_package_domain_use_player
        FOREIGN KEY (player_id) REFERENCES players(id),
    CONSTRAINT chk_package_domain_use_status
        CHECK (status IN ('PROCESSING', 'COMMITTED')),
    CONSTRAINT chk_package_domain_use_result_json
        CHECK (result_json IS NULL OR JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
