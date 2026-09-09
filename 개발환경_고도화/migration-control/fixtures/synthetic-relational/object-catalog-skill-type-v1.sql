INSERT INTO object_registry (
  object_key,
  object_type,
  display_name,
  active,
  metadata_json
) VALUES (
  'skill.synthetic_catalog_check',
  'SKILL',
  '합성 펫스킬',
  TRUE,
  JSON_OBJECT('catalog_version', 'ASSET-FREEZE-v2.400-a286279b-01', 'fixture', TRUE)
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = VALUES(active),
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', '합성 펫스킬'
FROM object_registry
WHERE object_key = 'skill.synthetic_catalog_check';

INSERT IGNORE INTO object_source_bindings (
  object_id,
  object_type,
  source_system,
  source_table,
  source_key
)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', 'synthetic_catalog_check'
FROM object_registry
WHERE object_key = 'skill.synthetic_catalog_check';
