-- 레거시 관리자 /펫탐 지급 명령을 실행 alias가 아닌 PKG-186 출처로 보존합니다.
START TRANSACTION;

INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
VALUES
  ('PKG-186','/펫탐','LEGACY_ADMIN_GRANT','/패키지지급',0,
    JSON_OBJECT(
      'sourceCommandId','CMD-10-0037',
      'legacyPattern','/펫탐[N], 대상',
      'legacyItemName','펫탐험패키지⛰️[1](/펫탐험오픈1)',
      'migrationPolicy','CATALOG_SEED_ONLY'
    ))
ON DUPLICATE KEY UPDATE
  source_kind=VALUES(source_kind),
  canonical_route=VALUES(canonical_route),
  executable=0,
  metadata_json=VALUES(metadata_json);

UPDATE package_item_definitions
SET metadata_json=JSON_SET(
      COALESCE(metadata_json,JSON_OBJECT()),
      '$.sourceGrantCommand','/펫탐',
      '$.grantRoute','/패키지지급',
      '$.useRoute','/패키지사용',
      '$.migrationPolicy','CATALOG_SEED_ONLY'
    ),
    row_version=row_version+1
WHERE item_id='ITEM-PACKAGE-186';

-- 레거시 지급 명령은 신규 dispatch로 실행하지 않습니다.
DELETE FROM package_command_aliases
WHERE command_text='/펫탐';

DELETE FROM command_aliases
WHERE command_text='/펫탐';

COMMIT;
