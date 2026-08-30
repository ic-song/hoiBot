START TRANSACTION;

DELETE entry_row
FROM title_definition_catalog_entries entry_row
JOIN title_definition_catalog_versions version_row ON version_row.id=entry_row.catalog_version_id
WHERE version_row.catalog_code='TITLE_DEFINITION_SCOPE_LEGACY'
  AND version_row.catalog_version=1
  AND version_row.source_hash='4133ec435d454768a6f29b9a7d14a2b309be27e782f86b58ac33cca088ad4fb7';

DELETE FROM title_definition_catalog_versions
WHERE catalog_code='TITLE_DEFINITION_SCOPE_LEGACY'
  AND catalog_version=1
  AND source_hash='4133ec435d454768a6f29b9a7d14a2b309be27e782f86b58ac33cca088ad4fb7';

COMMIT;
