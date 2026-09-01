START TRANSACTION;
CREATE TEMPORARY TABLE tmp_developer_note_entry_ids_422 (id BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO tmp_developer_note_entry_ids_422(id) SELECT binding.developer_note_entry_id FROM developer_note_deployment_entries binding JOIN developer_note_deployment_catalogs catalog ON catalog.id=binding.deployment_catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-developer-note-deployment-01';
DROP TABLE IF EXISTS developer_note_deployment_entries;
DELETE change_row FROM developer_note_changes change_row JOIN tmp_developer_note_entry_ids_422 target ON target.id=change_row.entry_id;
DELETE entry FROM developer_note_entries entry JOIN tmp_developer_note_entry_ids_422 target ON target.id=entry.id;
DROP TABLE IF EXISTS developer_note_deployment_catalogs;
DROP TEMPORARY TABLE tmp_developer_note_entry_ids_422;
COMMIT;
