SELECT
  COUNT(*) AS objects,
  COUNT(DISTINCT binding_row.source_key) AS definition_bindings,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.ownerScope')) = 'PLAYER') AS player_scopes,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.ownerScope')) = 'GUILD') AS guild_scopes,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.definitionVersion')) = '1') AS version_matches,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.sourceHash')) =
      '09e9be41c9106aa5faf1ad7686aa00f20071e951522a6071a0671a6cc93d8466') AS hash_matches
FROM object_registry object_row
JOIN object_source_bindings binding_row
  ON binding_row.object_id = object_row.id
 AND binding_row.object_type = object_row.object_type
 AND binding_row.source_system = 'RUNTIME_DB'
 AND binding_row.source_table = 'currency_definitions'
WHERE object_row.object_type = 'CURRENCY'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-currency-object-link-01';

SELECT COUNT(*) AS forbidden_uppercase_point_links
FROM object_source_bindings
WHERE source_system = 'RUNTIME_DB'
  AND source_table = 'currency_definitions'
  AND source_key = 'POINT';
