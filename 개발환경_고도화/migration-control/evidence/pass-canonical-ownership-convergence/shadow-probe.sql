SELECT definition_row.pass_code,definition_row.display_name,COUNT(ownership_row.id) AS canonical_owners
FROM support_pass_definitions definition_row
LEFT JOIN player_support_passes ownership_row ON ownership_row.pass_code=definition_row.pass_code
WHERE definition_row.pass_code IN ('contribution','diamond','oneday','hoi','newbie','premium')
GROUP BY definition_row.pass_code,definition_row.display_name
ORDER BY FIELD(definition_row.pass_code,'contribution','diamond','oneday','hoi','newbie','premium');

SELECT COUNT(*) AS mapped_compatibility_rows,
       SUM(canonical_row.id IS NOT NULL) AS canonical_matches,
       SUM(canonical_row.entitlement_kind='permanent' AND canonical_row.end_date IS NULL) AS null_expiry_matches
FROM player_passes compatibility_row
LEFT JOIN player_support_passes canonical_row
  ON canonical_row.player_id=compatibility_row.player_id
 AND canonical_row.pass_code=CASE compatibility_row.pass_code WHEN 'support' THEN 'hoi' WHEN 'beginner' THEN 'newbie' ELSE 'premium' END
WHERE compatibility_row.pass_code IN ('support','beginner','premium');

SELECT COUNT(*) AS change_events FROM support_pass_change_events;
