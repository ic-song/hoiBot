-- ASCII rollback is safe only when no active row contains a non-ASCII grade.
SELECT (
  SELECT rollback_preflight_guard
  FROM (
    SELECT 1 AS rollback_preflight_guard
    UNION ALL
    SELECT 2 WHERE EXISTS (
      SELECT 1 FROM canonical_pet_skill_definitions
      WHERE pet_skill_grade IS NOT NULL AND pet_skill_grade REGEXP '[^ -~]'
    )
  ) AS rollback_preflight
) AS rollback_preflight_guard;

ALTER TABLE canonical_pet_skill_definitions
  MODIFY COLUMN pet_skill_grade VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL;
