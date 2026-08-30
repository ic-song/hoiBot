SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json)
SELECT CONCAT('item.pendant.',LOWER(SUBSTRING(definition_row.code,LENGTH('ITEM-PENDANT-DRAW-')+1))),
       'ITEM',definition_row.display_name,1,TRUE,
       JSON_MERGE_PATCH(
         definition_row.metadata_json,
         JSON_OBJECT(
           'domain','pendant_definition',
           'definitionCode',definition_row.code,
           'catalogVersion','ASSET-FREEZE-v2.400-pendant-object-link-01'
         )
       )
FROM item_definitions definition_row
WHERE definition_row.code LIKE 'ITEM-PENDANT-DRAW-%'
  AND definition_row.code<>'ITEM-PENDANT-DRAW-TICKET'
  AND definition_row.asset_type_code='PENDANT'
  AND definition_row.stackable=FALSE
  AND JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.objectType'))='pendant'
ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.drawOrder')) AS UNSIGNED)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  active=TRUE,
  metadata_json=VALUES(metadata_json);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'ITEM','RUNTIME_DB','item_definitions',definition_row.code
FROM item_definitions definition_row
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('item.pendant.',LOWER(SUBSTRING(definition_row.code,LENGTH('ITEM-PENDANT-DRAW-')+1)))
 AND object_row.object_type='ITEM'
WHERE definition_row.code LIKE 'ITEM-PENDANT-DRAW-%'
  AND definition_row.code<>'ITEM-PENDANT-DRAW-TICKET'
  AND definition_row.asset_type_code='PENDANT'
  AND definition_row.stackable=FALSE
  AND JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.objectType'))='pendant'
ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.drawOrder')) AS UNSIGNED)
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

COMMIT;
