SELECT
  COUNT(*) AS physical_version_rows,
  SUM(definition_version_id = 930000002) AS current_definition_rows,
  COUNT(DISTINCT CASE WHEN definition_version_id = 930000002 THEN badge_code END) AS current_badge_codes
FROM home_badge_definitions;

SELECT
  COUNT(*) AS objects,
  COUNT(DISTINCT object_key) AS distinct_object_keys,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.lifecycleClass')) = 'AWARD') AS award_lifecycle,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.lifecycleClass')) = 'DISPLAY') AS display_lifecycle,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.sourceHash')) =
      '70d6731d0c5e2f72832fe70042ab1e0a7ba16d38af106b71617a31c33ed7932b') AS source_hash_matches
FROM object_registry
WHERE object_type = 'BADGE'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-badge-object-link-01';

SELECT COUNT(*) AS source_bindings
FROM object_source_bindings binding_row
JOIN object_registry object_row ON object_row.id = binding_row.object_id
WHERE binding_row.object_type = 'BADGE'
  AND binding_row.source_system = 'RUNTIME_DB'
  AND binding_row.source_table = 'home_badge_definitions'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-badge-object-link-01';

SELECT COUNT(*) AS aliases
FROM object_aliases alias_row
JOIN object_registry object_row ON object_row.id = alias_row.object_id
WHERE JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-badge-object-link-01';

SELECT COUNT(*) AS ownership_rows FROM player_home_badges;
