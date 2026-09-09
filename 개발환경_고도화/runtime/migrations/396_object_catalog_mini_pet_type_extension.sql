ALTER TABLE object_registry
  DROP CONSTRAINT chk_object_registry_type,
  ADD CONSTRAINT chk_object_registry_type
    CHECK (object_type IN ('ITEM', 'PET', 'FURNITURE', 'TITLE', 'PET_TITLE', 'PACKAGE', 'CURRENCY', 'SKILL', 'HOME_BUILDING', 'MINI_PET'));
