INSERT INTO object_registry (
  object_key,
  object_type,
  display_name,
  active,
  metadata_json
) VALUES (
  'home_building.synthetic_catalog_check',
  'HOME_BUILDING',
  '합성 홈 건물',
  TRUE,
  JSON_OBJECT('catalog_version', 'ASSET-FREEZE-v2.400-a286279b-01', 'fixture', TRUE)
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = VALUES(active),
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '합성 홈 건물'
FROM object_registry
WHERE object_key = 'home_building.synthetic_catalog_check';

INSERT IGNORE INTO object_source_bindings (
  object_id,
  object_type,
  source_system,
  source_table,
  source_key
)
SELECT id, object_type, 'LEGACY_JSON', 'HOME_BUILDING_LIST', 'synthetic_catalog_check'
FROM object_registry
WHERE object_key = 'home_building.synthetic_catalog_check';
