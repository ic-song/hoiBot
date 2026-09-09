-- 레거시 패키지 명령을 실행 alias가 아닌 카탈로그 출처 데이터로 보존합니다.
CREATE TABLE IF NOT EXISTS package_catalog_source_commands (
  package_id VARCHAR(64) NOT NULL,
  source_command VARCHAR(191) NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  canonical_route VARCHAR(64) NOT NULL,
  executable TINYINT(1) NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (package_id, source_command),
  CONSTRAINT fk_package_source_command_catalog
    FOREIGN KEY (package_id) REFERENCES package_catalog(package_id),
  CONSTRAINT chk_package_source_command_metadata
    CHECK (metadata_json IS NULL OR JSON_VALID(metadata_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
VALUES
  ('PKG-098','/도파민오픈2','LEGACY_OPEN','/패키지사용',0,
    JSON_OBJECT('sourceId','LEGACY-PKG-CMD-098','migrationPolicy','CATALOG_SEED_ONLY')),
  ('PKG-098','/도파민민','LEGACY_ADMIN_GRANT','/패키지지급',0,
    JSON_OBJECT('sourceCommandId','CMD-06-0028','legacyPattern','/도파민민[N], 대상','migrationPolicy','CATALOG_SEED_ONLY'))
ON DUPLICATE KEY UPDATE
  source_kind=VALUES(source_kind),canonical_route=VALUES(canonical_route),
  executable=0,metadata_json=VALUES(metadata_json);

UPDATE package_item_definitions
SET metadata_json=JSON_SET(
      COALESCE(metadata_json,JSON_OBJECT()),
      '$.sourceGrantCommand','/도파민민',
      '$.grantRoute','/패키지지급',
      '$.useRoute','/패키지사용',
      '$.migrationPolicy','CATALOG_SEED_ONLY'
    ),
    row_version=row_version+1
WHERE item_id='ITEM-PACKAGE-098';

-- 전용 명령은 신규 dispatch에 등록하지 않고 공용 패키지 명령으로만 실행합니다.
DELETE FROM package_command_aliases
WHERE package_id='PKG-098' OR command_text IN ('/도파민오픈2','/도파민민');

DELETE FROM command_aliases
WHERE command_text IN ('/도파민오픈2','/도파민민');

COMMIT;
