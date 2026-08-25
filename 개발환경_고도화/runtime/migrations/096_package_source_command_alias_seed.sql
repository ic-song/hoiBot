START TRANSACTION;

-- 아이템 metadata에만 있던 이벤트 패키지 보조 개봉명을 비실행 출처 seed로 보존합니다.
INSERT INTO package_catalog_source_commands
  (package_id,source_command,source_kind,canonical_route,executable,metadata_json)
VALUES
  ('PKG-EVENT-DUNGEON-BOX','/이벤트박스오픈✡️','LEGACY_OPEN_ALIAS','/패키지사용',0,
   JSON_OBJECT(
     'migrationPolicy','CATALOG_SEED_ONLY',
     'primarySourceCommand','/이벤박스오픈'
   ))
ON DUPLICATE KEY UPDATE
  source_kind=VALUES(source_kind),
  canonical_route=VALUES(canonical_route),
  executable=0,
  metadata_json=VALUES(metadata_json);

DELETE FROM package_command_aliases
WHERE command_text='/이벤트박스오픈✡️';

DELETE FROM command_aliases
WHERE command_text='/이벤트박스오픈✡️';

COMMIT;
