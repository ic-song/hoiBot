CREATE TABLE IF NOT EXISTS home_badge_definition_versions (
  id BIGINT UNSIGNED NOT NULL,
  version_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_home_badge_definition_version_key(version_key),
  CONSTRAINT chk_home_badge_definition_status CHECK(status IN('draft','shadow','published','retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_badge_definitions (
  definition_version_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  emoji_value VARCHAR(32) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  detail_text VARCHAR(500) NOT NULL,
  criteria_json JSON NULL,
  required_badge_codes_json JSON NULL,
  PRIMARY KEY(definition_version_id,badge_code),
  UNIQUE KEY uq_home_badge_definition_ordinal(definition_version_id,ordinal),
  CONSTRAINT fk_home_badge_definition_version FOREIGN KEY(definition_version_id)
    REFERENCES home_badge_definition_versions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_badge_definition_ordinal CHECK(ordinal BETWEEN 1 AND 204),
  CONSTRAINT chk_home_badge_definition_source CHECK(source_code IN('achievement','special','gacha','mbti','love'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_badge_inventory_reads (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  definition_version_id BIGINT UNSIGNED NOT NULL,
  command_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_text VARCHAR(191) NULL,
  result_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  awarded_badges_json LONGTEXT NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_home_badge_inventory_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_home_badge_inventory_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_home_badge_inventory_version FOREIGN KEY(definition_version_id) REFERENCES home_badge_definition_versions(id),
  CONSTRAINT chk_home_badge_inventory_awards CHECK(JSON_VALID(awarded_badges_json)),
  CONSTRAINT chk_home_badge_inventory_snapshot CHECK(JSON_VALID(snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO home_badge_definition_versions(id,version_key,content_hash,status,effective_at) VALUES
(930000001,'legacy-structure-v1-pending-name-parity',SHA2('achievement64|special13|gacha57|mbti20|love50',256),'shadow','2026-08-28 00:00:00.000')
ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),status=VALUES(status),effective_at=VALUES(effective_at);

INSERT INTO home_badge_definitions(
  definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,
  detail_text,criteria_json,required_badge_codes_json
)
SELECT 930000001,CASE WHEN definition.badge_code='F06' THEN 6 ELSE definition.sort_order END,
  definition.badge_code,'achievement',NULL,
  CASE WHEN definition.badge_code='F06' THEN '💎' ELSE definition.emoji END,
  definition.display_name,'펫홈 활동 업적 조건을 달성하면 획득합니다.',
  CASE WHEN definition.badge_code='F06' THEN JSON_OBJECT('followers',200) ELSE definition.criteria_json END,
  CASE WHEN definition.badge_code='F06' THEN NULL ELSE definition.required_badge_codes_json END
FROM pet_home_badge_definitions definition
WHERE definition.active=TRUE AND definition.badge_category='activity'
ON DUPLICATE KEY UPDATE source_code=VALUES(source_code),emoji_value=VALUES(emoji_value),
  display_name=VALUES(display_name),detail_text=VALUES(detail_text),
  criteria_json=VALUES(criteria_json),required_badge_codes_json=VALUES(required_badge_codes_json);

INSERT INTO home_badge_definitions(
  definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,
  detail_text,criteria_json,required_badge_codes_json
) VALUES (
  930000001,61,'A06','achievement',NULL,'🦄','펫홈 인플루언서',
  '펫홈 활동 업적 조건을 달성하면 획득합니다.',
  JSON_OBJECT('followers',100,'receivedComments',300,'totalVisits',3000),NULL
) ON DUPLICATE KEY UPDATE source_code=VALUES(source_code),emoji_value=VALUES(emoji_value),
  display_name=VALUES(display_name),detail_text=VALUES(detail_text),
  criteria_json=VALUES(criteria_json),required_badge_codes_json=VALUES(required_badge_codes_json);

INSERT INTO home_badge_definitions(
  definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text
)
SELECT 930000001,64+CAST(SUBSTRING(definition.badge_code,2) AS UNSIGNED),definition.badge_code,
  'special',NULL,definition.emoji,definition.display_name,'운영자 지급 특별 뱃지'
FROM pet_home_badge_definitions definition
WHERE definition.active=TRUE AND definition.badge_category='special'
ON DUPLICATE KEY UPDATE source_code=VALUES(source_code),emoji_value=VALUES(emoji_value),
  display_name=VALUES(display_name),detail_text=VALUES(detail_text);

INSERT INTO home_badge_definitions(
  definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text
)
WITH RECURSIVE sequence_rows AS (SELECT 1 n UNION ALL SELECT n+1 FROM sequence_rows WHERE n<57)
SELECT 930000001,77+n,CONCAT('HB',LPAD(n,3,'0')),'gacha',
  CASE WHEN n<=23 THEN 'C' WHEN n<=40 THEN 'B' WHEN n<=51 THEN 'A' ELSE 'S' END,
  '🛡️',CONCAT('기존 뽑기 홈뱃지 ',LPAD(n,3,'0')),'기존 홈뱃지 뽑기에서 획득합니다.'
FROM sequence_rows;

INSERT INTO home_badge_definitions(
  definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text
)
WITH RECURSIVE sequence_rows AS (SELECT 1 n UNION ALL SELECT n+1 FROM sequence_rows WHERE n<20)
SELECT 930000001,134+n,CONCAT('MBTI',LPAD(n,2,'0')),'mbti',NULL,'🧩',
  CONCAT('MBTI 홈뱃지 ',LPAD(n,2,'0')),'MBTI 홈뱃지 뽑기에서 획득합니다.'
FROM sequence_rows;

INSERT INTO home_badge_definitions(
  definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text
)
WITH RECURSIVE sequence_rows AS (SELECT 1 n UNION ALL SELECT n+1 FROM sequence_rows WHERE n<50)
SELECT 930000001,154+n,CONCAT('LOVE',LPAD(n,2,'0')),'love',NULL,'💞',
  CONCAT('연애유형 홈뱃지 ',LPAD(n,2,'0')),'연애유형 홈뱃지 뽑기에서 획득합니다.'
FROM sequence_rows;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('HOME_BADGE_OWNED_READ','home_badge_inventory_read','VERIFIED_USER','SHADOW',TRUE,1),
('HOME_BADGE_ALL_READ','home_badge_inventory_read','VERIFIED_USER','SHADOW',TRUE,1),
('HOME_BADGE_DETAIL_READ','home_badge_inventory_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/홈뱃지','HOME_BADGE_OWNED_READ',TRUE),
('/홈뱃지전체','HOME_BADGE_ALL_READ',TRUE),
('/홈뱃지정보','HOME_BADGE_DETAIL_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
