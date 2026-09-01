SELECT
  COUNT(*) AS objects,
  COUNT(DISTINCT binding_row.source_key) AS source_bindings,
  COUNT(DISTINCT CONCAT(
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.series')), '|',
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.badgeCode')), '|',
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.definitionVersion'))
  )) AS stable_identities,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.lifecycleClass')) = 'AWARD') AS award_lifecycle,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.lifecycleClass')) = 'DISPLAY') AS display_lifecycle,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.sourceHash')) = version_row.content_hash) AS hash_matches
FROM object_registry object_row
JOIN object_source_bindings binding_row
  ON binding_row.object_id = object_row.id
 AND binding_row.object_type = object_row.object_type
 AND binding_row.source_system = 'RUNTIME_DB'
 AND binding_row.source_table = 'home_badge_definitions'
JOIN home_badge_definition_versions version_row
  ON version_row.id = 930000002
WHERE object_row.object_type = 'BADGE'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-badge-object-link-01';

SELECT
  COUNT(*) AS physical_version_rows,
  SUM(definition_version_id = 930000002) AS canonical_current_rows,
  (SELECT COUNT(*) FROM player_home_badges) AS ownership_rows
FROM home_badge_definitions;
