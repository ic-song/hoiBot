CREATE TABLE hoiland_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    display_name VARCHAR(191) NOT NULL,
    display_order BIGINT UNSIGNED NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_hoiland_categories_key (category_key),
    UNIQUE KEY uq_hoiland_categories_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hoiland_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(30,0) NOT NULL DEFAULT 0,
    version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_hoiland_entries_category_player (category_id, player_id),
    KEY idx_hoiland_entries_player (player_id, category_id),
    CONSTRAINT fk_hoiland_entries_category FOREIGN KEY (category_id) REFERENCES hoiland_categories (id) ON DELETE RESTRICT,
    CONSTRAINT fk_hoiland_entries_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hoiland_edit_mutations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operation_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    target_amount DECIMAL(30,0) NOT NULL,
    affected_category_count BIGINT UNSIGNED NOT NULL,
    result_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_hoiland_edit_mutations_operation (operation_id),
    CONSTRAINT fk_hoiland_edit_mutations_operation FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE RESTRICT,
    CONSTRAINT fk_hoiland_edit_mutations_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry (
    command_code,
    handler_key,
    auth_scope,
    rollout_state,
    enabled,
    version
) VALUES (
    'ADMIN_HOILAND_EDIT',
    'ADMIN_HOILAND_EDIT',
    'VERIFIED_USER',
    'SHADOW',
    1,
    1
)
ON DUPLICATE KEY UPDATE
    handler_key = VALUES(handler_key),
    auth_scope = VALUES(auth_scope),
    enabled = VALUES(enabled),
    version = version + 1;
