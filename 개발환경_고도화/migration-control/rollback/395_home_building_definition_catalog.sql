START TRANSACTION;

DELETE FROM home_building_progression
WHERE catalog_version='ASSET-FREEZE-v2.400-home-building-01';

DELETE binding_row
FROM object_source_bindings binding_row
JOIN object_registry object_row ON object_row.id=binding_row.object_id
WHERE object_row.object_type='HOME_BUILDING'
  AND binding_row.source_system='LEGACY_JSON'
  AND binding_row.source_table='petSweetHomeInfo.homeInfo';

DELETE FROM object_registry
WHERE object_type='HOME_BUILDING'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-home-building-01';

COMMIT;

DROP TABLE IF EXISTS home_building_progression;
