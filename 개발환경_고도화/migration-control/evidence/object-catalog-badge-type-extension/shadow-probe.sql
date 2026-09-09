SELECT
  SUM(LOCATE(CONCAT('''', expected.object_type, ''''), checks.CHECK_CLAUSE) > 0) AS existing_types_preserved,
  SUM(expected.object_type = 'BADGE' AND LOCATE('''BADGE''', checks.CHECK_CLAUSE) > 0) AS badge_type_present
FROM (
  SELECT 'ITEM' AS object_type UNION ALL SELECT 'PET' UNION ALL SELECT 'FURNITURE'
  UNION ALL SELECT 'TITLE' UNION ALL SELECT 'PET_TITLE' UNION ALL SELECT 'PACKAGE'
  UNION ALL SELECT 'CURRENCY' UNION ALL SELECT 'SKILL' UNION ALL SELECT 'HOME_BUILDING'
  UNION ALL SELECT 'MINI_PET' UNION ALL SELECT 'BADGE'
) expected
JOIN information_schema.CHECK_CONSTRAINTS checks
  ON checks.CONSTRAINT_SCHEMA = DATABASE()
 AND checks.CONSTRAINT_NAME = 'chk_object_registry_type';

SELECT
  (SELECT COUNT(*) FROM object_registry WHERE object_type = 'BADGE') AS badge_objects,
  (SELECT COUNT(*) FROM home_badge_definitions) AS badge_definitions,
  (SELECT COUNT(*) FROM player_home_badges) AS badge_ownership_rows;
