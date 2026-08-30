START TRANSACTION;

DELETE binding_row
FROM object_source_bindings binding_row
JOIN object_registry object_row ON object_row.id=binding_row.object_id
WHERE object_row.object_type='ITEM'
  AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-pendant-object-link-01';

DELETE FROM object_registry
WHERE object_type='ITEM'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-pendant-object-link-01';

COMMIT;
