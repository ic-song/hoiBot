-- Destructive rollback guard: runtime rollback must first remove its exact bridge-owned rows and identities.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (SELECT 1 FROM canonical_elemental_grade_definition_bridges)
       OR EXISTS (
         SELECT 1 FROM object_identity_crosswalks
         WHERE source_system = 'CATALOG_MANIFEST'
           AND source_namespace = 'elemental-grade-definition.bridge.v1'
       )
       OR EXISTS (
         SELECT 1 FROM object_identities
         WHERE object_type = 'ELEMENTAL_GRADE_DEFINITION_BRIDGE'
       )
  ) AS rollback_preflight
) AS rollback_preflight_guard;

DROP TABLE IF EXISTS canonical_elemental_grade_definition_bridges;
