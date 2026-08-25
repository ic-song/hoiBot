START TRANSACTION;

-- 카탈로그에 보존된 레거시 개봉 명령을 실행 불가능한 출처 seed로 정규화합니다.
INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
SELECT
  catalog.package_id,
  catalog.source_legacy_command,
  'LEGACY_OPEN',
  '/패키지사용',
  0,
  JSON_OBJECT(
    'migrationPolicy','CATALOG_SEED_ONLY',
    'catalogVersion',catalog.catalog_version
  )
FROM package_catalog catalog
WHERE catalog.source_legacy_command IS NOT NULL
  AND catalog.source_legacy_command <> ''
ON DUPLICATE KEY UPDATE
  source_kind=VALUES(source_kind),
  canonical_route=VALUES(canonical_route),
  executable=0,
  metadata_json=VALUES(metadata_json);

-- 개별 개봉 명령은 패키지 전용 alias와 공용 dispatch alias 양쪽에서 제거합니다.
DELETE package_alias
FROM package_command_aliases package_alias
JOIN package_catalog catalog
  ON catalog.package_id=package_alias.package_id
  OR catalog.source_legacy_command=package_alias.command_text
WHERE catalog.source_legacy_command IS NOT NULL;

DELETE command_alias
FROM command_aliases command_alias
JOIN package_catalog catalog
  ON catalog.source_legacy_command=command_alias.command_text
WHERE catalog.source_legacy_command IS NOT NULL;

COMMIT;
