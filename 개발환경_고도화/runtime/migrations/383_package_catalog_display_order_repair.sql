START TRANSACTION;

UPDATE package_catalog
SET display_order = 59,
    row_version = row_version + 1
WHERE package_id = 'PKG-TRIAL-BOX'
  AND display_order = 39
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT package_id
      FROM package_catalog
      WHERE display_order = 59
        AND deleted_at IS NULL
        AND package_id <> 'PKG-TRIAL-BOX'
    ) AS occupied_display_order
  );

COMMIT;
