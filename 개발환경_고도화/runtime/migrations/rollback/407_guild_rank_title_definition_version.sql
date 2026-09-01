DELETE FROM title_definition_catalog_entries
WHERE catalog_version_id IN (
    SELECT versions.id
    FROM title_definition_catalog_versions versions
    WHERE versions.catalog_code = 'TITLE_DEFINITION_SCOPE_LEGACY'
      AND versions.catalog_version = 1
  )
  AND source_scope = 'GUILD_RANK'
  AND definition_version = 1
  AND lifecycle_code = 'ACTIVE';

DELETE FROM guild_rank_title_definitions
WHERE definition_version = 1
  AND title_code LIKE 'GUILD-RANK-%';

DELETE definitions
FROM title_definitions definitions
WHERE definitions.scope_code = 'GUILD_RANK'
  AND definitions.code LIKE 'GUILD-RANK-%'
  AND NOT EXISTS (
    SELECT 1
    FROM title_definition_catalog_entries entries
    WHERE entries.legacy_title_definition_id = definitions.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_titles owned WHERE owned.title_id = definitions.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_title_instances instances WHERE instances.title_id = definitions.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM pet_titles selected WHERE selected.title_id = definitions.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_pet_title_instances instances WHERE instances.legacy_title_definition_id = definitions.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM mini_pet_title_assignments assignments WHERE assignments.title_id = definitions.id
  );
