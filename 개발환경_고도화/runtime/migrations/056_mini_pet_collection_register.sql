CREATE TABLE mini_pet_collection_states (
  player_id BIGINT UNSIGNED NOT NULL,
  current_stage SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  completed_stage SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_minipet_collection_state_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_collection_state_stage CHECK (current_stage BETWEEN 1 AND 100 AND completed_stage BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_collection_grade_rules (
  grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_display_name VARCHAR(64) NOT NULL,
  source_order TINYINT UNSIGNED NOT NULL,
  minimum_progress BIGINT UNSIGNED NOT NULL DEFAULT 0,
  point_cost_per_missing_progress BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reward_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (grade_code),
  UNIQUE KEY uq_minipet_collection_grade_order (source_order),
  CONSTRAINT ck_minipet_collection_grade_order CHECK (source_order BETWEEN 1 AND 8)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_collection_stage_rules (
  stage_no SMALLINT UNSIGNED NOT NULL,
  reward_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_quantity BIGINT UNSIGNED NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (stage_no),
  CONSTRAINT fk_minipet_collection_stage_title FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_collection_stage_no CHECK (stage_no BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_collection_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  selection_json JSON NOT NULL,
  selection_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  expires_at DATETIME(3) NOT NULL,
  preview_operation_id BIGINT UNSIGNED NOT NULL,
  consume_operation_id BIGINT UNSIGNED NULL,
  cancel_operation_id BIGINT UNSIGNED NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_minipet_collection_confirmation_token (token_hash),
  KEY ix_minipet_collection_confirmation_pending (player_id, status, expires_at),
  CONSTRAINT fk_minipet_collection_confirmation_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_collection_confirmation_preview FOREIGN KEY (preview_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_collection_confirmation_consume FOREIGN KEY (consume_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_collection_confirmation_cancel FOREIGN KEY (cancel_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_collection_confirmation_status CHECK (status IN ('pending', 'consumed', 'cancelled', 'expired', 'replaced'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_collection_registration_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  confirmation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  selection_count TINYINT UNSIGNED NOT NULL,
  stage_before SMALLINT UNSIGNED NOT NULL,
  stage_after SMALLINT UNSIGNED NOT NULL,
  completed_stage SMALLINT UNSIGNED NOT NULL,
  point_cost DECIMAL(30,3) NOT NULL DEFAULT 0,
  rewards_json JSON NOT NULL,
  title_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_minipet_collection_registration_operation (operation_id),
  UNIQUE KEY uq_minipet_collection_registration_confirmation (confirmation_id),
  KEY ix_minipet_collection_registration_player (player_id, created_at),
  CONSTRAINT fk_minipet_collection_registration_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_collection_registration_confirmation FOREIGN KEY (confirmation_id) REFERENCES mini_pet_collection_confirmations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_collection_registration_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_minipet_collection_registration_title FOREIGN KEY (title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT ck_minipet_collection_registration_count CHECK (selection_count BETWEEN 1 AND 8)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO mini_pet_collection_grade_rules
  (grade_code, grade_display_name, source_order, minimum_progress, point_cost_per_missing_progress, reward_item_code, reward_quantity, active, version)
VALUES
  ('mythic', '신화', 1, 0, 0, 'pet_food', 900, TRUE, 1),
  ('mythic_plus', '신화+', 2, 0, 0, 'pet_food', 1000, TRUE, 1),
  ('transcendence', '초월', 3, 0, 0, 'pet_food', 1200, TRUE, 1),
  ('transcendence_plus', '초월+', 4, 0, 0, 'pet_food', 1500, TRUE, 1),
  ('primordial', '태초', 5, 0, 0, 'pet_food', 3000, TRUE, 1),
  ('primordial_plus', '태초+', 6, 0, 0, 'pet_food', 5000, TRUE, 1),
  ('genesis', '창세', 7, 0, 0, 'pet_food', 7000, TRUE, 1),
  ('creation', '창조', 8, 0, 0, 'pet_food', 10000, TRUE, 1)

ON DUPLICATE KEY UPDATE grade_display_name=VALUES(grade_display_name), source_order=VALUES(source_order), reward_item_code=VALUES(reward_item_code), reward_quantity=VALUES(reward_quantity), active=TRUE, version=version+1;

INSERT INTO title_definitions (code, display_name, scope_code, active) VALUES
  ('mini_pet_collection_stage_001', '미니펫 첫 수집가🐹', 'player', TRUE),
  ('mini_pet_collection_stage_002', '미니펫 입문자👾', 'player', TRUE),
  ('mini_pet_collection_stage_003', '초보 수집가🌱', 'player', TRUE),
  ('mini_pet_collection_stage_004', '작은 발걸음👣', 'player', TRUE),
  ('mini_pet_collection_stage_005', '펫 수집 연습생🤸‍♂️', 'player', TRUE),
  ('mini_pet_collection_stage_006', '컬렉션 시작자👒', 'player', TRUE),
  ('mini_pet_collection_stage_007', '수집의 기초👶🏻', 'player', TRUE),
  ('mini_pet_collection_stage_008', '미니펫 애호가💪', 'player', TRUE),
  ('mini_pet_collection_stage_009', '수집 초심자👨‍🌾', 'player', TRUE),
  ('mini_pet_collection_stage_010', '미니펫 관심자😉', 'player', TRUE),
  ('mini_pet_collection_stage_011', '미니펫 지망생🎤', 'player', TRUE),
  ('mini_pet_collection_stage_012', '펫 모으는 자🧢', 'player', TRUE),
  ('mini_pet_collection_stage_013', '수집 중독자👨‍🌾', 'player', TRUE),
  ('mini_pet_collection_stage_014', '미니펫 탐색가🔎', 'player', TRUE),
  ('mini_pet_collection_stage_015', '컬렉션 유망주✨️', 'player', TRUE),
  ('mini_pet_collection_stage_016', '수집의 재미🥕', 'player', TRUE),
  ('mini_pet_collection_stage_017', '펫 수집 전문가👨‍⚕️', 'player', TRUE),
  ('mini_pet_collection_stage_018', '미니펫 애장가🤭', 'player', TRUE),
  ('mini_pet_collection_stage_019', '펫 수집 달인🤡', 'player', TRUE),
  ('mini_pet_collection_stage_020', '컬렉션 마니아🤖', 'player', TRUE),
  ('mini_pet_collection_stage_021', '미니펫 헌터🔫', 'player', TRUE),
  ('mini_pet_collection_stage_022', '펫 탐험가🎭', 'player', TRUE),
  ('mini_pet_collection_stage_023', '컬렉션 개척자🧳', 'player', TRUE),
  ('mini_pet_collection_stage_024', '미니펫 연구가🧪', 'player', TRUE),
  ('mini_pet_collection_stage_025', '수집 설계자👨‍🎨', 'player', TRUE),
  ('mini_pet_collection_stage_026', '펫 감정사🧙‍♂️', 'player', TRUE),
  ('mini_pet_collection_stage_027', '미니펫 기록자✍️', 'player', TRUE),
  ('mini_pet_collection_stage_028', '수집 관리자✨️', 'player', TRUE),
  ('mini_pet_collection_stage_029', '컬렉션 관리자🌠', 'player', TRUE),
  ('mini_pet_collection_stage_030', '미니펫 관리자🥼', 'player', TRUE),
  ('mini_pet_collection_stage_031', '미니펫 전문가👨‍👧', 'player', TRUE),
  ('mini_pet_collection_stage_032', '펫 마스터 후보🏅', 'player', TRUE),
  ('mini_pet_collection_stage_033', '컬렉션 전략가💌', 'player', TRUE),
  ('mini_pet_collection_stage_034', '수집 분석가📖', 'player', TRUE),
  ('mini_pet_collection_stage_035', '펫 트레이너🤠', 'player', TRUE),
  ('mini_pet_collection_stage_036', '미니펫 조련사🤺', 'player', TRUE),
  ('mini_pet_collection_stage_037', '컬렉션 장비자👨‍🔧', 'player', TRUE),
  ('mini_pet_collection_stage_038', '수집 설계 마스터 📚', 'player', TRUE),
  ('mini_pet_collection_stage_039', '미니펫 통제자🧐', 'player', TRUE),
  ('mini_pet_collection_stage_040', '펫 수집 관리자👺', 'player', TRUE),
  ('mini_pet_collection_stage_041', '컬렉션 마스터🎒', 'player', TRUE),
  ('mini_pet_collection_stage_042', '미니펫 숙련자👨‍🏫', 'player', TRUE),
  ('mini_pet_collection_stage_043', '펫 수집 장인 후보🧔‍♂️', 'player', TRUE),
  ('mini_pet_collection_stage_044', '수집 통달자🔱', 'player', TRUE),
  ('mini_pet_collection_stage_045', '미니펫 지배자🍷', 'player', TRUE),
  ('mini_pet_collection_stage_046', '컬렉션 설계자🏠', 'player', TRUE),
  ('mini_pet_collection_stage_047', '수집 총괄자🎠', 'player', TRUE),
  ('mini_pet_collection_stage_048', '미니펫 상위권💒', 'player', TRUE),
  ('mini_pet_collection_stage_049', '미니펫 핵심 유저🏷', 'player', TRUE),
  ('mini_pet_collection_stage_050', '컬렉션 핵심 유저😎', 'player', TRUE),
  ('mini_pet_collection_stage_051', '펫 수집 지휘관🪽', 'player', TRUE),
  ('mini_pet_collection_stage_052', '미니펫 전략가🗽', 'player', TRUE),
  ('mini_pet_collection_stage_053', '컬렉션 관리자장👓', 'player', TRUE),
  ('mini_pet_collection_stage_054', '미니펫 수집 고수📖', 'player', TRUE),
  ('mini_pet_collection_stage_055', '미니펫 전문가장🔎', 'player', TRUE),
  ('mini_pet_collection_stage_056', '펫 통제자🔑', 'player', TRUE),
  ('mini_pet_collection_stage_057', '컬렉션 관리자👷', 'player', TRUE),
  ('mini_pet_collection_stage_058', '수집 총괄자🧑‍🚀', 'player', TRUE),
  ('mini_pet_collection_stage_059', '미니펫 상위권💯', 'player', TRUE),
  ('mini_pet_collection_stage_060', '펫 수집 상위자👨‍💼', 'player', TRUE),
  ('mini_pet_collection_stage_061', '미니펫 장인👨‍✈️', 'player', TRUE),
  ('mini_pet_collection_stage_062', '펫 수집 장인💘', 'player', TRUE),
  ('mini_pet_collection_stage_063', '컬렉션 장인🎻', 'player', TRUE),
  ('mini_pet_collection_stage_064', '미니펫 숙련 장인👑', 'player', TRUE),
  ('mini_pet_collection_stage_065', '수집 완성 장인🤹', 'player', TRUE),
  ('mini_pet_collection_stage_066', '펫 강화 장인🤾‍♀️', 'player', TRUE),
  ('mini_pet_collection_stage_067', '컬렉션 완성자👨‍🎓', 'player', TRUE),
  ('mini_pet_collection_stage_068', '미니펫 장인장👨‍🔧', 'player', TRUE),
  ('mini_pet_collection_stage_069', '펫 수집 통달자🧜‍♂️', 'player', TRUE),
  ('mini_pet_collection_stage_070', '컬렉션 절대자🤳', 'player', TRUE),
  ('mini_pet_collection_stage_071', '미니펫 고수🤵', 'player', TRUE),
  ('mini_pet_collection_stage_072', '펫 수집 고수💂', 'player', TRUE),
  ('mini_pet_collection_stage_073', '컬렉션 고수👔', 'player', TRUE),
  ('mini_pet_collection_stage_074', '미니펫 달인👨‍🏫', 'player', TRUE),
  ('mini_pet_collection_stage_075', '펫 수집 달인🧑‍🏫', 'player', TRUE),
  ('mini_pet_collection_stage_076', '컬렉션 달인👩‍🏫', 'player', TRUE),
  ('mini_pet_collection_stage_077', '미니펫 상급자👨‍⚖️', 'player', TRUE),
  ('mini_pet_collection_stage_078', '펫 수집 상급자👩‍⚖️', 'player', TRUE),
  ('mini_pet_collection_stage_079', '컬렉션 상급자📒', 'player', TRUE),
  ('mini_pet_collection_stage_080', '미니펫 최상위자🛍', 'player', TRUE),
  ('mini_pet_collection_stage_081', '미니펫 초월자💎', 'player', TRUE),
  ('mini_pet_collection_stage_082', '컬렉션 초월자📕', 'player', TRUE),
  ('mini_pet_collection_stage_083', '펫 수집 초월자👜', 'player', TRUE),
  ('mini_pet_collection_stage_084', '미니펫 각성자📍', 'player', TRUE),
  ('mini_pet_collection_stage_085', '컬렉션 각성자📗', 'player', TRUE),
  ('mini_pet_collection_stage_086', '펫 수집 각성자✏️', 'player', TRUE),
  ('mini_pet_collection_stage_087', '미니펫 지배자💡', 'player', TRUE),
  ('mini_pet_collection_stage_088', '컬렉션 지배자🗿', 'player', TRUE),
  ('mini_pet_collection_stage_089', '펫 수집 지배자📒', 'player', TRUE),
  ('mini_pet_collection_stage_090', '미니펫 군주🎺', 'player', TRUE),
  ('mini_pet_collection_stage_091', '컬렉션 군주📣', 'player', TRUE),
  ('mini_pet_collection_stage_092', '펫 수집 군주🪖', 'player', TRUE),
  ('mini_pet_collection_stage_093', '미니펫 절대자💳', 'player', TRUE),
  ('mini_pet_collection_stage_094', '컬렉션 절대자🕶', 'player', TRUE),
  ('mini_pet_collection_stage_095', '펫 수집 절대자🌍', 'player', TRUE),
  ('mini_pet_collection_stage_096', '미니펫 신⚡️', 'player', TRUE),
  ('mini_pet_collection_stage_097', '컬렉션 신☀️', 'player', TRUE),
  ('mini_pet_collection_stage_098', '펫 수집의 신🌈', 'player', TRUE),
  ('mini_pet_collection_stage_099', '미니펫 창조자🪐', 'player', TRUE),
  ('mini_pet_collection_stage_100', '미니펫 궁극의 수집가💡', 'player', TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), scope_code=VALUES(scope_code), active=TRUE;

INSERT INTO mini_pet_collection_stage_rules (stage_no, reward_item_code, reward_quantity, title_id, active, version)
SELECT seed.stage_no, 'pet_food', seed.reward_quantity, title.id, TRUE, 1
FROM (
  SELECT 1 AS stage_no, 50000 AS reward_quantity, 'mini_pet_collection_stage_001' AS title_code
  UNION ALL SELECT 2, 60000, 'mini_pet_collection_stage_002'
  UNION ALL SELECT 3, 70000, 'mini_pet_collection_stage_003'
  UNION ALL SELECT 4, 80000, 'mini_pet_collection_stage_004'
  UNION ALL SELECT 5, 90000, 'mini_pet_collection_stage_005'
  UNION ALL SELECT 6, 100000, 'mini_pet_collection_stage_006'
  UNION ALL SELECT 7, 110000, 'mini_pet_collection_stage_007'
  UNION ALL SELECT 8, 120000, 'mini_pet_collection_stage_008'
  UNION ALL SELECT 9, 130000, 'mini_pet_collection_stage_009'
  UNION ALL SELECT 10, 150000, 'mini_pet_collection_stage_010'
  UNION ALL SELECT 11, 170000, 'mini_pet_collection_stage_011'
  UNION ALL SELECT 12, 190000, 'mini_pet_collection_stage_012'
  UNION ALL SELECT 13, 210000, 'mini_pet_collection_stage_013'
  UNION ALL SELECT 14, 230000, 'mini_pet_collection_stage_014'
  UNION ALL SELECT 15, 250000, 'mini_pet_collection_stage_015'
  UNION ALL SELECT 16, 270000, 'mini_pet_collection_stage_016'
  UNION ALL SELECT 17, 300000, 'mini_pet_collection_stage_017'
  UNION ALL SELECT 18, 330000, 'mini_pet_collection_stage_018'
  UNION ALL SELECT 19, 360000, 'mini_pet_collection_stage_019'
  UNION ALL SELECT 20, 400000, 'mini_pet_collection_stage_020'
  UNION ALL SELECT 21, 450000, 'mini_pet_collection_stage_021'
  UNION ALL SELECT 22, 500000, 'mini_pet_collection_stage_022'
  UNION ALL SELECT 23, 550000, 'mini_pet_collection_stage_023'
  UNION ALL SELECT 24, 600000, 'mini_pet_collection_stage_024'
  UNION ALL SELECT 25, 650000, 'mini_pet_collection_stage_025'
  UNION ALL SELECT 26, 700000, 'mini_pet_collection_stage_026'
  UNION ALL SELECT 27, 750000, 'mini_pet_collection_stage_027'
  UNION ALL SELECT 28, 800000, 'mini_pet_collection_stage_028'
  UNION ALL SELECT 29, 850000, 'mini_pet_collection_stage_029'
  UNION ALL SELECT 30, 1000000, 'mini_pet_collection_stage_030'
  UNION ALL SELECT 31, 1100000, 'mini_pet_collection_stage_031'
  UNION ALL SELECT 32, 1200000, 'mini_pet_collection_stage_032'
  UNION ALL SELECT 33, 1300000, 'mini_pet_collection_stage_033'
  UNION ALL SELECT 34, 1400000, 'mini_pet_collection_stage_034'
  UNION ALL SELECT 35, 1500000, 'mini_pet_collection_stage_035'
  UNION ALL SELECT 36, 1600000, 'mini_pet_collection_stage_036'
  UNION ALL SELECT 37, 1700000, 'mini_pet_collection_stage_037'
  UNION ALL SELECT 38, 1800000, 'mini_pet_collection_stage_038'
  UNION ALL SELECT 39, 1900000, 'mini_pet_collection_stage_039'
  UNION ALL SELECT 40, 2000000, 'mini_pet_collection_stage_040'
  UNION ALL SELECT 41, 2200000, 'mini_pet_collection_stage_041'
  UNION ALL SELECT 42, 2400000, 'mini_pet_collection_stage_042'
  UNION ALL SELECT 43, 2600000, 'mini_pet_collection_stage_043'
  UNION ALL SELECT 44, 2800000, 'mini_pet_collection_stage_044'
  UNION ALL SELECT 45, 3000000, 'mini_pet_collection_stage_045'
  UNION ALL SELECT 46, 3200000, 'mini_pet_collection_stage_046'
  UNION ALL SELECT 47, 3400000, 'mini_pet_collection_stage_047'
  UNION ALL SELECT 48, 3600000, 'mini_pet_collection_stage_048'
  UNION ALL SELECT 49, 3800000, 'mini_pet_collection_stage_049'
  UNION ALL SELECT 50, 4000000, 'mini_pet_collection_stage_050'
  UNION ALL SELECT 51, 4300000, 'mini_pet_collection_stage_051'
  UNION ALL SELECT 52, 4600000, 'mini_pet_collection_stage_052'
  UNION ALL SELECT 53, 4900000, 'mini_pet_collection_stage_053'
  UNION ALL SELECT 54, 5200000, 'mini_pet_collection_stage_054'
  UNION ALL SELECT 55, 5500000, 'mini_pet_collection_stage_055'
  UNION ALL SELECT 56, 5800000, 'mini_pet_collection_stage_056'
  UNION ALL SELECT 57, 6100000, 'mini_pet_collection_stage_057'
  UNION ALL SELECT 58, 6400000, 'mini_pet_collection_stage_058'
  UNION ALL SELECT 59, 6700000, 'mini_pet_collection_stage_059'
  UNION ALL SELECT 60, 7000000, 'mini_pet_collection_stage_060'
  UNION ALL SELECT 61, 7300000, 'mini_pet_collection_stage_061'
  UNION ALL SELECT 62, 7600000, 'mini_pet_collection_stage_062'
  UNION ALL SELECT 63, 7900000, 'mini_pet_collection_stage_063'
  UNION ALL SELECT 64, 8200000, 'mini_pet_collection_stage_064'
  UNION ALL SELECT 65, 8500000, 'mini_pet_collection_stage_065'
  UNION ALL SELECT 66, 8800000, 'mini_pet_collection_stage_066'
  UNION ALL SELECT 67, 9100000, 'mini_pet_collection_stage_067'
  UNION ALL SELECT 68, 9400000, 'mini_pet_collection_stage_068'
  UNION ALL SELECT 69, 9700000, 'mini_pet_collection_stage_069'
  UNION ALL SELECT 70, 10000000, 'mini_pet_collection_stage_070'
  UNION ALL SELECT 71, 10300000, 'mini_pet_collection_stage_071'
  UNION ALL SELECT 72, 10600000, 'mini_pet_collection_stage_072'
  UNION ALL SELECT 73, 10900000, 'mini_pet_collection_stage_073'
  UNION ALL SELECT 74, 11200000, 'mini_pet_collection_stage_074'
  UNION ALL SELECT 75, 11500000, 'mini_pet_collection_stage_075'
  UNION ALL SELECT 76, 11800000, 'mini_pet_collection_stage_076'
  UNION ALL SELECT 77, 12100000, 'mini_pet_collection_stage_077'
  UNION ALL SELECT 78, 12400000, 'mini_pet_collection_stage_078'
  UNION ALL SELECT 79, 12700000, 'mini_pet_collection_stage_079'
  UNION ALL SELECT 80, 13000000, 'mini_pet_collection_stage_080'
  UNION ALL SELECT 81, 13200000, 'mini_pet_collection_stage_081'
  UNION ALL SELECT 82, 13400000, 'mini_pet_collection_stage_082'
  UNION ALL SELECT 83, 13600000, 'mini_pet_collection_stage_083'
  UNION ALL SELECT 84, 13800000, 'mini_pet_collection_stage_084'
  UNION ALL SELECT 85, 14000000, 'mini_pet_collection_stage_085'
  UNION ALL SELECT 86, 14200000, 'mini_pet_collection_stage_086'
  UNION ALL SELECT 87, 14400000, 'mini_pet_collection_stage_087'
  UNION ALL SELECT 88, 14600000, 'mini_pet_collection_stage_088'
  UNION ALL SELECT 89, 14700000, 'mini_pet_collection_stage_089'
  UNION ALL SELECT 90, 14800000, 'mini_pet_collection_stage_090'
  UNION ALL SELECT 91, 14850000, 'mini_pet_collection_stage_091'
  UNION ALL SELECT 92, 14900000, 'mini_pet_collection_stage_092'
  UNION ALL SELECT 93, 14920000, 'mini_pet_collection_stage_093'
  UNION ALL SELECT 94, 14940000, 'mini_pet_collection_stage_094'
  UNION ALL SELECT 95, 14960000, 'mini_pet_collection_stage_095'
  UNION ALL SELECT 96, 14970000, 'mini_pet_collection_stage_096'
  UNION ALL SELECT 97, 14980000, 'mini_pet_collection_stage_097'
  UNION ALL SELECT 98, 14990000, 'mini_pet_collection_stage_098'
  UNION ALL SELECT 99, 14995000, 'mini_pet_collection_stage_099'
  UNION ALL SELECT 100, 15000000, 'mini_pet_collection_stage_100'
) seed JOIN title_definitions title ON title.code = seed.title_code
ON DUPLICATE KEY UPDATE reward_item_code=VALUES(reward_item_code), reward_quantity=VALUES(reward_quantity), title_id=VALUES(title_id), active=TRUE, version=version+1;
