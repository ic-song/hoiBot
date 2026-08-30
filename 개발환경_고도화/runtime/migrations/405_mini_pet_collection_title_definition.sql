SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE migration405_mini_pet_collection_titles(
  source_row INT UNSIGNED NOT NULL,
  stable_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  price_digits VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(source_row),
  UNIQUE KEY uq_migration405_code(stable_code),
  UNIQUE KEY uq_migration405_display(display_name),
  UNIQUE KEY uq_migration405_display_hash(display_hash),
  CONSTRAINT chk_migration405_row CHECK(source_row BETWEEN 1 AND 100),
  CONSTRAINT chk_migration405_hash CHECK(display_hash=CONVERT(LOWER(SHA2(display_name,256)) USING ascii))
) ENGINE=InnoDB;

INSERT INTO migration405_mini_pet_collection_titles(source_row,stable_code,display_name,price_digits,display_hash)
SELECT source_row,CONCAT('MINI-PET-COLLECTION-TITLE-',LPAD(source_row,3,'0')),display_name,'10000000000',LOWER(SHA2(display_name,256))
FROM JSON_TABLE(
  '[
    {"sourceRow":1,"displayName":"미니펫 첫 수집가🐹"},{"sourceRow":2,"displayName":"미니펫 입문자👾"},
    {"sourceRow":3,"displayName":"초보 수집가🌱"},{"sourceRow":4,"displayName":"작은 발걸음👣"},
    {"sourceRow":5,"displayName":"펫 수집 연습생🤸‍♂️"},{"sourceRow":6,"displayName":"컬렉션 시작자👒"},
    {"sourceRow":7,"displayName":"수집의 기초👶🏻"},{"sourceRow":8,"displayName":"미니펫 애호가💪"},
    {"sourceRow":9,"displayName":"수집 초심자👨‍🌾"},{"sourceRow":10,"displayName":"미니펫 관심자😉"},
    {"sourceRow":11,"displayName":"미니펫 지망생🎤"},{"sourceRow":12,"displayName":"펫 모으는 자🧢"},
    {"sourceRow":13,"displayName":"수집 중독자👨‍🌾"},{"sourceRow":14,"displayName":"미니펫 탐색가🔎"},
    {"sourceRow":15,"displayName":"컬렉션 유망주✨️"},{"sourceRow":16,"displayName":"수집의 재미🥕"},
    {"sourceRow":17,"displayName":"펫 수집 전문가👨‍⚕️"},{"sourceRow":18,"displayName":"미니펫 애장가🤭"},
    {"sourceRow":19,"displayName":"펫 수집 달인🤡"},{"sourceRow":20,"displayName":"컬렉션 마니아🤖"},
    {"sourceRow":21,"displayName":"미니펫 헌터🔫"},{"sourceRow":22,"displayName":"펫 탐험가🎭"},
    {"sourceRow":23,"displayName":"컬렉션 개척자🧳"},{"sourceRow":24,"displayName":"미니펫 연구가🧪"},
    {"sourceRow":25,"displayName":"수집 설계자👨‍🎨"},{"sourceRow":26,"displayName":"펫 감정사🧙‍♂️"},
    {"sourceRow":27,"displayName":"미니펫 기록자✍️"},{"sourceRow":28,"displayName":"수집 관리자✨️"},
    {"sourceRow":29,"displayName":"컬렉션 관리자🌠"},{"sourceRow":30,"displayName":"미니펫 관리자🥼"},
    {"sourceRow":31,"displayName":"미니펫 전문가👨‍👧"},{"sourceRow":32,"displayName":"펫 마스터 후보🏅"},
    {"sourceRow":33,"displayName":"컬렉션 전략가💌"},{"sourceRow":34,"displayName":"수집 분석가📖"},
    {"sourceRow":35,"displayName":"펫 트레이너🤠"},{"sourceRow":36,"displayName":"미니펫 조련사🤺"},
    {"sourceRow":37,"displayName":"컬렉션 장비자👨‍🔧"},{"sourceRow":38,"displayName":"수집 설계 마스터 📚"},
    {"sourceRow":39,"displayName":"미니펫 통제자🧐"},{"sourceRow":40,"displayName":"펫 수집 관리자👺"},
    {"sourceRow":41,"displayName":"컬렉션 마스터🎒"},{"sourceRow":42,"displayName":"미니펫 숙련자👨‍🏫"},
    {"sourceRow":43,"displayName":"펫 수집 장인 후보🧔‍♂️"},{"sourceRow":44,"displayName":"수집 통달자🔱"},
    {"sourceRow":45,"displayName":"미니펫 지배자🍷"},{"sourceRow":46,"displayName":"컬렉션 설계자🏠"},
    {"sourceRow":47,"displayName":"수집 총괄자🎠"},{"sourceRow":48,"displayName":"미니펫 상위권💒"},
    {"sourceRow":49,"displayName":"미니펫 핵심 유저🏷"},{"sourceRow":50,"displayName":"컬렉션 핵심 유저😎"},
    {"sourceRow":51,"displayName":"펫 수집 지휘관🪽"},{"sourceRow":52,"displayName":"미니펫 전략가🗽"},
    {"sourceRow":53,"displayName":"컬렉션 관리자장👓"},{"sourceRow":54,"displayName":"미니펫 수집 고수📖"},
    {"sourceRow":55,"displayName":"미니펫 전문가장🔎"},{"sourceRow":56,"displayName":"펫 통제자🔑"},
    {"sourceRow":57,"displayName":"컬렉션 관리자👷"},{"sourceRow":58,"displayName":"수집 총괄자🧑‍🚀"},
    {"sourceRow":59,"displayName":"미니펫 상위권💯"},{"sourceRow":60,"displayName":"펫 수집 상위자👨‍💼"},
    {"sourceRow":61,"displayName":"미니펫 장인👨‍✈️"},{"sourceRow":62,"displayName":"펫 수집 장인💘"},
    {"sourceRow":63,"displayName":"컬렉션 장인🎻"},{"sourceRow":64,"displayName":"미니펫 숙련 장인👑"},
    {"sourceRow":65,"displayName":"수집 완성 장인🤹"},{"sourceRow":66,"displayName":"펫 강화 장인🤾‍♀️"},
    {"sourceRow":67,"displayName":"컬렉션 완성자👨‍🎓"},{"sourceRow":68,"displayName":"미니펫 장인장👨‍🔧"},
    {"sourceRow":69,"displayName":"펫 수집 통달자🧜‍♂️"},{"sourceRow":70,"displayName":"컬렉션 절대자🤳"},
    {"sourceRow":71,"displayName":"미니펫 고수🤵"},{"sourceRow":72,"displayName":"펫 수집 고수💂"},
    {"sourceRow":73,"displayName":"컬렉션 고수👔"},{"sourceRow":74,"displayName":"미니펫 달인👨‍🏫"},
    {"sourceRow":75,"displayName":"펫 수집 달인🧑‍🏫"},{"sourceRow":76,"displayName":"컬렉션 달인👩‍🏫"},
    {"sourceRow":77,"displayName":"미니펫 상급자👨‍⚖️"},{"sourceRow":78,"displayName":"펫 수집 상급자👩‍⚖️"},
    {"sourceRow":79,"displayName":"컬렉션 상급자📒"},{"sourceRow":80,"displayName":"미니펫 최상위자🛍"},
    {"sourceRow":81,"displayName":"미니펫 초월자💎"},{"sourceRow":82,"displayName":"컬렉션 초월자📕"},
    {"sourceRow":83,"displayName":"펫 수집 초월자👜"},{"sourceRow":84,"displayName":"미니펫 각성자📍"},
    {"sourceRow":85,"displayName":"컬렉션 각성자📗"},{"sourceRow":86,"displayName":"펫 수집 각성자✏️"},
    {"sourceRow":87,"displayName":"미니펫 지배자💡"},{"sourceRow":88,"displayName":"컬렉션 지배자🗿"},
    {"sourceRow":89,"displayName":"펫 수집 지배자📒"},{"sourceRow":90,"displayName":"미니펫 군주🎺"},
    {"sourceRow":91,"displayName":"컬렉션 군주📣"},{"sourceRow":92,"displayName":"펫 수집 군주🪖"},
    {"sourceRow":93,"displayName":"미니펫 절대자💳"},{"sourceRow":94,"displayName":"컬렉션 절대자🕶"},
    {"sourceRow":95,"displayName":"펫 수집 절대자🌍"},{"sourceRow":96,"displayName":"미니펫 신⚡️"},
    {"sourceRow":97,"displayName":"컬렉션 신☀️"},{"sourceRow":98,"displayName":"펫 수집의 신🌈"},
    {"sourceRow":99,"displayName":"미니펫 창조자🪐"},{"sourceRow":100,"displayName":"미니펫 궁극의 수집가💡"}
  ]', '$[*]' COLUMNS(source_row INT PATH '$.sourceRow',display_name VARCHAR(191) CHARACTER SET utf8mb4 PATH '$.displayName')
) source_json;

CREATE TEMPORARY TABLE migration405_count_guard(
  row_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_migration405_count CHECK(row_count=100)
) ENGINE=InnoDB;
INSERT INTO migration405_count_guard SELECT COUNT(*) FROM migration405_mini_pet_collection_titles;

INSERT INTO title_definitions(code,display_name,scope_code,active)
SELECT stable_code,display_name,'mini_pet_collection',TRUE
FROM migration405_mini_pet_collection_titles
ON DUPLICATE KEY UPDATE
  display_name=IF(BINARY title_definitions.display_name=BINARY VALUES(display_name),title_definitions.display_name,NULL),
  scope_code=IF(scope_code=VALUES(scope_code),scope_code,NULL),active=TRUE;

INSERT INTO title_definition_catalog_entries(
  catalog_version_id,legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
  definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,metadata_json
)
SELECT version_row.id,definition.id,'RUNTIME_DB','title_definitions','MINI_PET_COLLECTION',source_row.stable_code,
       1,'ACTIVE','MINI_PET',source_row.display_name,TRUE,
       JSON_OBJECT('migrationCode','405_mini_pet_collection_title_definition','sourceFile','data/miniPetCollectionInfo.json',
         'sourceSection','titles','sourceRow',source_row.source_row,'priceDigits',source_row.price_digits,
         'displayHash',source_row.display_hash,'canonicalSourceHash','efbc7d49f6122f56715dfd3cd2be456b159842b6467da060ccd66a62575f433a',
         'excludedGradeRewardRows',8,'excludedStageRewardRows',100,
         'identityContract','source_scope+stable_code+definition_version+lifecycle')
FROM migration405_mini_pet_collection_titles source_row
JOIN title_definitions definition ON definition.code=source_row.stable_code
JOIN title_definition_catalog_versions version_row
  ON version_row.catalog_code='TITLE_DEFINITION_SCOPE_LEGACY'
 AND version_row.catalog_version=1 AND version_row.publish_state='PUBLISHED'
ON DUPLICATE KEY UPDATE
  legacy_title_definition_id=IF(legacy_title_definition_id=VALUES(legacy_title_definition_id),legacy_title_definition_id,NULL);

DROP TEMPORARY TABLE migration405_count_guard;
DROP TEMPORARY TABLE migration405_mini_pet_collection_titles;
COMMIT;
