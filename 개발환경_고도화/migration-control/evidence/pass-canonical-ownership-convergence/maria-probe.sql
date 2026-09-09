SELECT COUNT(*) AS definitions,
       SUM(pass_code IN ('contribution','diamond','oneday','hoi','newbie','premium')) AS semantic_definitions
FROM support_pass_definitions;

SELECT COUNT(*) AS canonical_rows,
       SUM(pass_code='hoi') AS hoi_rows,
       SUM(pass_code='newbie') AS newbie_rows,
       SUM(pass_code='premium') AS premium_rows,
       SUM(end_date IS NULL AND entitlement_kind='permanent') AS null_expiry_permanent
FROM player_support_passes;

SELECT COUNT(*) AS compatibility_rows,
       SUM(pass_code='support') AS support_rows,
       SUM(pass_code='beginner') AS beginner_rows,
       SUM(pass_code='premium') AS premium_rows
FROM player_passes
WHERE pass_code IN ('support','beginner','premium');

SELECT COUNT(*) AS backfill_operations
FROM operations WHERE idempotency_scope='migration.411.pass.canonical.backfill';
