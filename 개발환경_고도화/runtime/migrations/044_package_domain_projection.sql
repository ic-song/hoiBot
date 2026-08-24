INSERT INTO item_definitions (
    code, display_name, asset_type_code, stackable, metadata_json, active, version
)
SELECT
    item_id,
    item_name,
    'PACKAGE_ITEM',
    1,
    metadata_json,
    enabled,
    1
FROM package_item_definitions
WHERE item_type = 'STACK'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    metadata_json = VALUES(metadata_json),
    active = VALUES(active);

INSERT INTO currency_definitions (code, display_name, scale_digits, active)
SELECT
    COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.currencyCode')), ''), item_id),
    item_name,
    0,
    enabled
FROM package_item_definitions
WHERE item_type = 'POINT'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    active = VALUES(active);

INSERT INTO furniture_definitions (code, display_name, charm_value, active)
SELECT
    item_id,
    item_name,
    COALESCE(JSON_EXTRACT(metadata_json, '$.charmValue') + 0, 0),
    enabled
FROM package_item_definitions
WHERE item_type = 'FURNITURE'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    charm_value = VALUES(charm_value),
    active = VALUES(active);

INSERT INTO title_definitions (code, display_name, scope_code, active)
SELECT
    item_id,
    item_name,
    CASE WHEN item_type = 'PET_TITLE' THEN 'PET' ELSE 'PLAYER' END,
    enabled
FROM package_item_definitions
WHERE item_type IN ('MEMBER_TITLE', 'PET_TITLE')
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    scope_code = VALUES(scope_code),
    active = VALUES(active);

INSERT INTO mini_pet_definitions (
    code, display_name, grade_code, grade_display_name, emoji_value, active
)
SELECT
    item_id,
    item_name,
    COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.gradeCode')), ''), 'NORMAL'),
    COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.gradeDisplayName')), ''), '일반'),
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.emojiValue')), ''),
    enabled
FROM package_item_definitions
WHERE item_type = 'MINI_PET'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    grade_code = VALUES(grade_code),
    grade_display_name = VALUES(grade_display_name),
    emoji_value = VALUES(emoji_value),
    active = VALUES(active);

INSERT INTO pet_definitions (code, display_name, metadata_json, active)
SELECT item_id, item_name, metadata_json, enabled
FROM package_item_definitions
WHERE item_type = 'PET'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    metadata_json = VALUES(metadata_json),
    active = VALUES(active);

CREATE TABLE IF NOT EXISTS package_item_effects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operation_id BIGINT UNSIGNED NOT NULL,
    sequence_no INT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    package_item_id VARCHAR(128) NOT NULL,
    item_type VARCHAR(32) NOT NULL,
    target_id BIGINT UNSIGNED NULL,
    quantity_delta DECIMAL(30,3) NOT NULL,
    metadata_json LONGTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_package_item_effect_operation_sequence (operation_id, sequence_no),
    KEY ix_package_item_effect_player_item (player_id, package_item_id),
    CONSTRAINT fk_package_item_effect_operation
        FOREIGN KEY (operation_id) REFERENCES operations(id),
    CONSTRAINT chk_package_item_effect_metadata_json CHECK (JSON_VALID(metadata_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
