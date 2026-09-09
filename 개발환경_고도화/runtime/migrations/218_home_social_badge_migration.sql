START TRANSACTION;

ALTER TABLE pet_home_badge_definitions
  ADD COLUMN IF NOT EXISTS criteria_json JSON NULL AFTER display_name,
  ADD COLUMN IF NOT EXISTS required_badge_codes_json JSON NULL AFTER criteria_json,
  ADD COLUMN IF NOT EXISTS sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER required_badge_codes_json;

CREATE TABLE IF NOT EXISTS pet_home_badge_stats (
  player_id BIGINT UNSIGNED NOT NULL,
  followers BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mutual BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_comments BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_home_likes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_reactions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_visits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  feed_active_days BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_pet_home_badge_stats_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_home_badge_exclusions (
  player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'legacy_permanent_delete',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id,badge_code),
  CONSTRAINT fk_home_badge_exclusion_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_feed_activity_days (
  player_id BIGINT UNSIGNED NOT NULL,
  activity_date DATE NOT NULL,
  source_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'legacy_feed',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id,activity_date),
  CONSTRAINT fk_pet_home_feed_day_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_social_badge_migration_state (
  migration_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  applied_operation_id BIGINT UNSIGNED NULL,
  processed_user_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  awarded_badge_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  applied_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (migration_key),
  CONSTRAINT fk_home_social_badge_state_operation FOREIGN KEY (applied_operation_id) REFERENCES operations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_social_badge_stat_backups (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  had_stats BOOLEAN NOT NULL,
  followers BIGINT UNSIGNED NOT NULL,
  mutual BIGINT UNSIGNED NOT NULL,
  received_comments BIGINT UNSIGNED NOT NULL,
  received_home_likes BIGINT UNSIGNED NOT NULL,
  received_reactions BIGINT UNSIGNED NOT NULL,
  total_visits BIGINT UNSIGNED NOT NULL,
  feed_active_days BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (operation_id,player_id),
  CONSTRAINT fk_home_social_badge_backup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_social_badge_backup_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_social_badge_assignment_backups (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_value VARCHAR(500) NOT NULL,
  priority INT NOT NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  PRIMARY KEY (operation_id,player_id,badge_code),
  CONSTRAINT fk_home_social_assignment_backup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_social_assignment_backup_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_social_badge_migration_awards (
  operation_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_value VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id,sequence_no),
  UNIQUE KEY uq_home_social_badge_award (operation_id,player_id,badge_code),
  CONSTRAINT fk_home_social_badge_award_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_social_badge_award_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_home_social_badge_migration_runs (
  operation_id BIGINT UNSIGNED NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  migration_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  processed_user_count BIGINT UNSIGNED NOT NULL,
  awarded_badge_count BIGINT UNSIGNED NOT NULL,
  backup_operation_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  KEY idx_home_social_badge_runs_created (created_at),
  CONSTRAINT fk_home_social_badge_run_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_social_badge_run_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_social_badge_run_backup FOREIGN KEY (backup_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_social_badge_run_status CHECK (migration_status IN ('migrated','already_applied'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_home_badge_definitions(badge_code,badge_category,emoji,display_name,criteria_json,required_badge_codes_json,sort_order,active,version) VALUES
('F01','activity','🌱','첫인연',JSON_OBJECT('followers',1),NULL,1,TRUE,1),
('F02','activity','🐾','친근한 홈',JSON_OBJECT('followers',10),NULL,2,TRUE,1),
('F03','activity','🌼','소문난 홈',JSON_OBJECT('followers',30),NULL,3,TRUE,1),
('F04','activity','🦋','인기 펫홈',JSON_OBJECT('followers',50),NULL,4,TRUE,1),
('F05','activity','👑','펫홈 스타',JSON_OBJECT('followers',100),NULL,5,TRUE,1),
('F06','activity','💎','펫홈 인플루언서',JSON_OBJECT('followers',200),NULL,6,TRUE,1),
('F07','activity','🌟','호이월드 셀럽',JSON_OBJECT('followers',300),NULL,7,TRUE,1),
('F08','activity','🪽','모두의 친구',JSON_OBJECT('followers',500),NULL,8,TRUE,1),
('F09','activity','🏆','팔로워 레전드',JSON_OBJECT('followers',1000),NULL,9,TRUE,1),
('M01','activity','🤝','첫 맞팔',JSON_OBJECT('mutual',1),NULL,10,TRUE,1),
('M02','activity','🫶','가까운 사이',JSON_OBJECT('mutual',10),NULL,11,TRUE,1),
('M03','activity','🎀','인맥이 넓은 홈',JSON_OBJECT('mutual',30),NULL,12,TRUE,1),
('M04','activity','💞','우정 가득',JSON_OBJECT('mutual',50),NULL,13,TRUE,1),
('M05','activity','🌈','인싸 펫홈',JSON_OBJECT('mutual',100),NULL,14,TRUE,1),
('M06','activity','💫','호이월드 마당발',JSON_OBJECT('mutual',300),NULL,15,TRUE,1),
('C01','activity','💬','첫 대화',JSON_OBJECT('receivedComments',1),NULL,16,TRUE,1),
('C02','activity','✏️','대화가 시작된 홈',JSON_OBJECT('receivedComments',10),NULL,17,TRUE,1),
('C03','activity','📮','이야기 우체통',JSON_OBJECT('receivedComments',30),NULL,18,TRUE,1),
('C04','activity','🗨️','북적이는 홈',JSON_OBJECT('receivedComments',50),NULL,19,TRUE,1),
('C05','activity','📖','이야기꾼',JSON_OBJECT('receivedComments',100),NULL,20,TRUE,1),
('C06','activity','🎙️','소통의 달인',JSON_OBJECT('receivedComments',300),NULL,21,TRUE,1),
('C07','activity','📚','이야기 도서관',JSON_OBJECT('receivedComments',500),NULL,22,TRUE,1),
('C08','activity','🏰','소통 왕국',JSON_OBJECT('receivedComments',1000),NULL,23,TRUE,1),
('L01','activity','🤍','첫 번째 좋아홈',JSON_OBJECT('receivedHomeLikes',1),NULL,24,TRUE,1),
('L02','activity','💗','포근한 홈',JSON_OBJECT('receivedHomeLikes',10),NULL,25,TRUE,1),
('L03','activity','💕','사랑이 머무는 곳',JSON_OBJECT('receivedHomeLikes',30),NULL,26,TRUE,1),
('L04','activity','💖','사랑받는 홈',JSON_OBJECT('receivedHomeLikes',100),NULL,27,TRUE,1),
('L05','activity','💝','애정 가득 펫홈',JSON_OBJECT('receivedHomeLikes',300),NULL,28,TRUE,1),
('L06','activity','💘','모두가 사랑한 홈',JSON_OBJECT('receivedHomeLikes',500),NULL,29,TRUE,1),
('L07','activity','❤️‍🔥','사랑의 전당',JSON_OBJECT('receivedHomeLikes',1000),NULL,30,TRUE,1),
('R01','activity','💌','첫 마음',JSON_OBJECT('receivedReactions',1),NULL,31,TRUE,1),
('R02','activity','😊','기분 좋은 홈',JSON_OBJECT('receivedReactions',10),NULL,32,TRUE,1),
('R03','activity','✨','반짝이는 홈',JSON_OBJECT('receivedReactions',50),NULL,33,TRUE,1),
('R04','activity','🥰','마음 부자',JSON_OBJECT('receivedReactions',100),NULL,34,TRUE,1),
('R05','activity','🎆','표현이 넘치는 홈',JSON_OBJECT('receivedReactions',300),NULL,35,TRUE,1),
('R06','activity','💟','마음 수집가',JSON_OBJECT('receivedReactions',500),NULL,36,TRUE,1),
('R07','activity','💓','모두의 마음속에',JSON_OBJECT('receivedReactions',1000),NULL,37,TRUE,1),
('R08','activity','😎','모두 날 좋아해',JSON_OBJECT('receivedReactions',10000),NULL,38,TRUE,1),
('V01','activity','👣','첫 방문',JSON_OBJECT('totalVisits',1),NULL,39,TRUE,1),
('V02','activity','🚪','손님이 찾아온 홈',JSON_OBJECT('totalVisits',10),NULL,40,TRUE,1),
('V03','activity','☕','동네 사랑방',JSON_OBJECT('totalVisits',100),NULL,41,TRUE,1),
('V04','activity','🎪','펫홈 핫플레이스',JSON_OBJECT('totalVisits',500),NULL,42,TRUE,1),
('V05','activity','🏡','홈마스터',JSON_OBJECT('totalVisits',1000),NULL,43,TRUE,1),
('V06','activity','🏙️','호이월드 명소',JSON_OBJECT('totalVisits',3000),NULL,44,TRUE,1),
('V07','activity','🗼','호이월드 랜드마크',JSON_OBJECT('totalVisits',10000),NULL,45,TRUE,1),
('P01','activity','📝','첫 소식',JSON_OBJECT('feedActiveDays',1),NULL,46,TRUE,1),
('P02','activity','🌱','이야기의 시작',JSON_OBJECT('feedActiveDays',3),NULL,47,TRUE,1),
('P03','activity','📮','소식 배달부',JSON_OBJECT('feedActiveDays',7),NULL,48,TRUE,1),
('P04','activity','☕','일상의 기록',JSON_OBJECT('feedActiveDays',15),NULL,49,TRUE,1),
('P05','activity','📖','꾸준한 기록가',JSON_OBJECT('feedActiveDays',30),NULL,50,TRUE,1),
('P06','activity','🪶','펫하우스 작가',JSON_OBJECT('feedActiveDays',60),NULL,51,TRUE,1),
('P07','activity','📰','피드 발행인',JSON_OBJECT('feedActiveDays',100),NULL,52,TRUE,1),
('P08','activity','🎙️','호월 이야기꾼',JSON_OBJECT('feedActiveDays',180),NULL,53,TRUE,1),
('P09','activity','🌟','피드 마스터',JSON_OBJECT('feedActiveDays',300),NULL,54,TRUE,1),
('P10','activity','👑','전설의 기록가',JSON_OBJECT('feedActiveDays',365),NULL,55,TRUE,1),
('A01','activity','🪴','펫홈 새내기',JSON_OBJECT('followers',10,'receivedHomeLikes',10),NULL,56,TRUE,1),
('A02','activity','🧸','따뜻한 이웃',JSON_OBJECT('mutual',10,'receivedComments',30),NULL,57,TRUE,1),
('A03','activity','🎉','활기찬 펫홈',JSON_OBJECT('receivedComments',50,'receivedReactions',50),NULL,58,TRUE,1),
('A04','activity','🏠','펫홈 애호가',JSON_OBJECT('totalVisits',500,'receivedHomeLikes',50),NULL,59,TRUE,1),
('A05','activity','🪄','펫홈 크리에이터',JSON_OBJECT('followers',50,'receivedHomeLikes',100,'totalVisits',1000),NULL,60,TRUE,1),
('A06','activity','🦄','펫홈 인플루언서',JSON_OBJECT('followers',100,'receivedComments',300,'totalVisits',3000),NULL,61,TRUE,1),
('A07','activity','🔱','호이월드 유명인',JSON_OBJECT('followers',300,'receivedHomeLikes',500,'totalVisits',5000,'receivedReactions',1000),NULL,62,TRUE,1),
('A08','activity','👑','펫홈의 제왕',JSON_OBJECT('followers',500,'receivedComments',1000,'totalVisits',10000),NULL,63,TRUE,1),
('A09','activity','🏆','명예의 전당',NULL,JSON_ARRAY('A01','A02','A03','A04','A05','A06','A07','A08'),64,TRUE,1)
ON DUPLICATE KEY UPDATE badge_category=VALUES(badge_category),emoji=VALUES(emoji),display_name=VALUES(display_name),criteria_json=VALUES(criteria_json),required_badge_codes_json=VALUES(required_badge_codes_json),sort_order=VALUES(sort_order),active=TRUE,version=version+1;

INSERT INTO pet_home_social_badge_migration_state(migration_key,applied,processed_user_count,awarded_badge_count,version)
VALUES ('pet_home_social_badges_20260727',FALSE,0,0,1)
ON DUPLICATE KEY UPDATE migration_key=VALUES(migration_key);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('HOME_SOCIAL_BADGE_MIGRATION','home_social_badge_migration','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫홈소셜뱃지마이그레이션','HOME_SOCIAL_BADGE_MIGRATION',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
