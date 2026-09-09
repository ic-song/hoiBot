SELECT COUNT(*) AS canonical_definition_count
FROM currency_definitions
WHERE code IN ('point', 'diamond', 'guild_fund');

SELECT COUNT(*) AS object_count
FROM object_registry
WHERE object_type = 'CURRENCY'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-currency-object-link-01';

SELECT COUNT(*) AS binding_count
FROM object_source_bindings binding_row
JOIN object_registry object_row ON object_row.id = binding_row.object_id
WHERE binding_row.object_type = 'CURRENCY'
  AND binding_row.source_system = 'RUNTIME_DB'
  AND binding_row.source_table = 'currency_definitions'
  AND binding_row.source_key IN ('point', 'diamond', 'guild_fund')
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-currency-object-link-01';

SELECT COUNT(*) AS alias_count
FROM object_aliases alias_row
JOIN object_registry object_row ON object_row.id = alias_row.object_id
WHERE JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-currency-object-link-01';

SELECT COUNT(*) AS uppercase_point_links
FROM object_source_bindings
WHERE source_system = 'RUNTIME_DB'
  AND source_table = 'currency_definitions'
  AND source_key = 'POINT';

SELECT object_key, JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.ownerScope')) AS owner_scope
FROM object_registry
WHERE object_type = 'CURRENCY'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.catalogVersion')) =
      'ASSET-FREEZE-v2.400-currency-object-link-01'
ORDER BY object_key;
