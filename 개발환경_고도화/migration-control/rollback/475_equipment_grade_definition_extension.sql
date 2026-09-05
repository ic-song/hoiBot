-- Destructive rollback guard: canonical catalog rows require an explicit cleanup/export decision first.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (SELECT 1 FROM canonical_equipment_grade_aliases)
       OR EXISTS (SELECT 1 FROM canonical_equipment_grade_definitions)
  ) AS rollback_preflight
) AS rollback_preflight_guard;

-- FK-safe reverse order.
DROP TABLE IF EXISTS canonical_equipment_grade_aliases;
DROP TABLE IF EXISTS canonical_equipment_grade_definitions;
