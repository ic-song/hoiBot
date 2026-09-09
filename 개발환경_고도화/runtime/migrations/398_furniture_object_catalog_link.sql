SET NAMES utf8mb4;
START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS tmp_furniture_object_crosswalk_398;
CREATE TEMPORARY TABLE tmp_furniture_object_crosswalk_398 AS
SELECT entry_row.source_sequence,
       definition_row.code source_code,
       definition_row.display_name normalized_display,
       definition_row.charm_value,
       entry_row.grade_ordinal,
       entry_row.source_display_snapshot,
       entry_row.source_rate_text,
       MIN(definition_row.code) OVER (
         PARTITION BY BINARY definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal
       ) canonical_code,
       COUNT(*) OVER (
         PARTITION BY BINARY definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal
       ) occurrence_count
FROM home_furniture_draw_entries entry_row
JOIN home_furniture_draw_catalog_versions catalog_row ON catalog_row.id=entry_row.catalog_version_id
JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id
WHERE catalog_row.source_sha256='73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195';

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json)
SELECT CONCAT('furniture.catalog_',LOWER(canonical_code)),
       'FURNITURE',normalized_display,1,TRUE,
       JSON_OBJECT(
         'domain','home_furniture_definition',
         'canonicalDefinitionCode',canonical_code,
         'normalizedDisplay',normalized_display,
         'charmValue',charm_value,
         'gradeOrdinal',grade_ordinal,
         'sourceOccurrenceCount',occurrence_count,
         'sourceHash','73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195',
         'catalogVersion','ASSET-FREEZE-v2.400-furniture-object-link-01'
       )
FROM tmp_furniture_object_crosswalk_398
WHERE source_code=canonical_code
ORDER BY source_sequence
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  active=TRUE,
  metadata_json=VALUES(metadata_json);

INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value)
SELECT object_row.id,'FURNITURE','legacy_code',crosswalk_row.source_code
FROM tmp_furniture_object_crosswalk_398 crosswalk_row
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('furniture.catalog_',LOWER(crosswalk_row.canonical_code))
 AND object_row.object_type='FURNITURE'
ORDER BY crosswalk_row.source_sequence
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'FURNITURE','LEGACY_JSON','petSweetHomeInfo.furnitureDraw',
       CONCAT('source-row-',LPAD(crosswalk_row.source_sequence,4,'0'))
FROM tmp_furniture_object_crosswalk_398 crosswalk_row
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('furniture.catalog_',LOWER(crosswalk_row.canonical_code))
 AND object_row.object_type='FURNITURE'
ORDER BY crosswalk_row.source_sequence
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

DROP TEMPORARY TABLE tmp_furniture_object_crosswalk_398;
COMMIT;
