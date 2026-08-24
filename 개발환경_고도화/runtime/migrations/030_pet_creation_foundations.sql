ALTER TABLE player_pets
  ADD COLUMN joined_on DATE NULL AFTER image_value,
  ADD COLUMN personality_label VARCHAR(191) NULL AFTER joined_on,
  ADD COLUMN enhancement_updated_at DATETIME(3) NULL AFTER enhancement_level;

CREATE TABLE player_pet_elementals (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_display_name VARCHAR(191) NOT NULL,
  enhancement_level BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (player_pet_id),
  CONSTRAINT fk_player_pet_elemental_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_skill_inventory (
  player_pet_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_pet_id, skill_id),
  CONSTRAINT fk_pet_skill_inventory_pet FOREIGN KEY (player_pet_id) REFERENCES player_pets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_skill_inventory_skill FOREIGN KEY (skill_id) REFERENCES skill_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_definitions (code, display_name, metadata_json, active) VALUES
  ('legacy-sky', '하늘', JSON_OBJECT('legacyCode', '하늘'), TRUE),
  ('legacy-land', '땅', JSON_OBJECT('legacyCode', '땅'), TRUE),
  ('legacy-sea', '바다', JSON_OBJECT('legacyCode', '바다'), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), metadata_json = VALUES(metadata_json), active = VALUES(active);

INSERT INTO skill_definitions (code, display_name, rules_json, active) VALUES
  ('legacy-ten-won', '십원✨', JSON_OBJECT('legacyStarterQuantity', 1), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), rules_json = VALUES(rules_json), active = VALUES(active);

INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active) VALUES
  ('legacy-starter-mini-pet', '초보자전용미니펫', 'rare', '희귀', '🌱', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = VALUES(active);
