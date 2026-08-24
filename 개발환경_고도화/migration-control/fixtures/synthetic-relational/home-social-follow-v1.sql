DELETE FROM home_activity_alerts WHERE target_player_id IN (900000001, 900000002, 900000003);
DELETE FROM home_follow_relationships
WHERE followed_player_id IN (900000001, 900000002, 900000003)
   OR follower_player_id IN (900000001, 900000002, 900000003);

INSERT INTO player_passes (player_id, pass_code, enabled, permanent, starts_at, ends_at) VALUES
  (900000001, 'support', TRUE, FALSE, '2026-01-01 00:00:00.000', '2027-01-01 00:00:00.000'),
  (900000002, 'support', TRUE, FALSE, '2026-01-01 00:00:00.000', '2027-01-01 00:00:00.000'),
  (900000003, 'support', FALSE, FALSE, NULL, NULL)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), permanent = VALUES(permanent), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at);

INSERT INTO home_badge_definitions (badge_code, display_name, active, criteria_json) VALUES
  ('synthetic-followers-1', '🐾 첫 팔로워', TRUE, JSON_OBJECT('stat', 'followers', 'threshold', 1)),
  ('synthetic-mutual-1', '🤝 첫 맞팔', TRUE, JSON_OBJECT('stat', 'mutual', 'threshold', 1))
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = VALUES(active), criteria_json = VALUES(criteria_json);

DELETE FROM player_badge_assignments
WHERE player_id IN (900000001, 900000002, 900000003)
  AND badge_code IN ('synthetic-followers-1', 'synthetic-mutual-1');
