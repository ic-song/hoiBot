START TRANSACTION;

DELETE source_row
FROM object_source_bindings source_row
JOIN object_registry object_row ON object_row.id=source_row.object_id
WHERE object_row.object_type='ITEM'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-common-item-object-gap-01';

DELETE alias_row
FROM object_aliases alias_row
JOIN object_registry object_row ON object_row.id=alias_row.object_id
WHERE object_row.object_type='ITEM'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-common-item-object-gap-01';

DELETE FROM object_registry
WHERE object_type='ITEM'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-common-item-object-gap-01';

DELETE definition_row
FROM item_definitions definition_row
WHERE JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.seededByMigration'))='401_common_item_object_gap_link.sql'
  AND definition_row.code IN ('ITEM-TERRITORY-AMBUSH-10','ITEM-TERRITORY-DEFENSE-20')
  AND NOT EXISTS (
    SELECT 1 FROM object_registry object_row
    WHERE JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionTarget'))=CONCAT('item_definitions|',definition_row.code)
  )
  AND NOT EXISTS (
    SELECT 1 FROM object_source_bindings source_row
    WHERE source_row.source_system='RUNTIME_DB' AND source_row.source_table='item_definitions' AND source_row.source_key=definition_row.code
  );

COMMIT;
