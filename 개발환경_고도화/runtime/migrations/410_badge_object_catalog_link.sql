SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_m410_badge_identity AS
SELECT
  definition_row.definition_version_id,
  definition_row.ordinal,
  definition_row.badge_code,
  definition_row.source_code AS series_code,
  CASE WHEN definition_row.ordinal <= 77 THEN 'AWARD' ELSE 'DISPLAY' END AS lifecycle_class,
  definition_row.grade_code,
  definition_row.emoji_value,
  definition_row.display_name,
  version_row.content_hash AS source_hash,
  CONCAT(
    'badge.', LOWER(definition_row.source_code), '.', LOWER(definition_row.badge_code),
    '.v', definition_row.definition_version_id
  ) AS object_key,
  CONCAT(
    definition_row.definition_version_id, '|', definition_row.source_code, '|', definition_row.badge_code
  ) AS source_key
FROM home_badge_definitions definition_row
JOIN home_badge_definition_versions version_row
  ON version_row.id = definition_row.definition_version_id
WHERE definition_row.definition_version_id = 930000002
  AND version_row.content_hash = '70d6731d0c5e2f72832fe70042ab1e0a7ba16d38af106b71617a31c33ed7932b';

INSERT INTO object_registry
  (object_key, object_type, display_name, version, active, metadata_json)
SELECT
  identity_row.object_key,
  'BADGE',
  identity_row.display_name,
  1,
  TRUE,
  JSON_OBJECT(
    'domain', 'home_badge_definition',
    'badgeCode', identity_row.badge_code,
    'series', identity_row.series_code,
    'definitionVersion', identity_row.definition_version_id,
    'lifecycleClass', identity_row.lifecycle_class,
    'ordinal', identity_row.ordinal,
    'gradeCode', identity_row.grade_code,
    'emoji', identity_row.emoji_value,
    'definitionBinding', CONCAT('RUNTIME_DB|home_badge_definitions|', identity_row.source_key),
    'catalogVersion', 'ASSET-FREEZE-v2.400-badge-object-link-01',
    'sourceHash', identity_row.source_hash
  )
FROM tmp_m410_badge_identity identity_row
ORDER BY identity_row.ordinal
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT INTO object_source_bindings
  (object_id, object_type, source_system, source_table, source_key)
SELECT
  object_row.id,
  'BADGE',
  'RUNTIME_DB',
  'home_badge_definitions',
  identity_row.source_key
FROM tmp_m410_badge_identity identity_row
JOIN object_registry object_row
  ON object_row.object_key = identity_row.object_key
 AND object_row.object_type = 'BADGE'
ORDER BY identity_row.ordinal
ON DUPLICATE KEY UPDATE
  object_id = VALUES(object_id),
  object_type = VALUES(object_type);

DROP TEMPORARY TABLE tmp_m410_badge_identity;
COMMIT;
