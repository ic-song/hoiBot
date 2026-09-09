START TRANSACTION;

DELETE FROM title_definition_catalog_entries
WHERE source_scope='MINI_PET_COLLECTION' AND definition_version=1
  AND stable_code LIKE 'MINI-PET-COLLECTION-TITLE-%';

DELETE definition FROM title_definitions definition
LEFT JOIN title_definition_catalog_entries catalog_entry ON catalog_entry.legacy_title_definition_id=definition.id
LEFT JOIN player_titles player_assignment ON player_assignment.title_id=definition.id
LEFT JOIN pet_titles pet_assignment ON pet_assignment.title_id=definition.id
LEFT JOIN mini_pet_title_assignments mini_assignment ON mini_assignment.title_id=definition.id
WHERE definition.scope_code='mini_pet_collection'
  AND definition.code LIKE 'MINI-PET-COLLECTION-TITLE-%'
  AND catalog_entry.id IS NULL AND player_assignment.title_id IS NULL
  AND pet_assignment.title_id IS NULL AND mini_assignment.title_id IS NULL;

COMMIT;
