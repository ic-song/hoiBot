DELETE FROM home_follow_relationships
WHERE followed_player_id IN (900000001, 900000002, 900000003)
   OR follower_player_id IN (900000001, 900000002, 900000003);

INSERT INTO home_follow_relationships
  (followed_player_id, follower_player_id, status, followed_at, updated_at) VALUES
  (900000001, 900000002, 'active', '2026-02-20 12:00:00.000', '2026-02-20 12:00:00.000'),
  (900000001, 900000003, 'active', '2026-02-20 12:00:00.000', '2026-02-20 12:00:00.000'),
  (900000002, 900000001, 'active', '2026-02-20 12:00:00.000', '2026-02-20 12:00:00.000'),
  (900000003, 900000001, 'removed', '2026-02-20 12:00:00.000', '2026-02-21 12:00:00.000');

INSERT INTO home_heart_expression_totals
  (player_id, cute_count, cheer_count, cool_count, love_count, version, updated_at) VALUES
  (900000001, 1, 2, 3, 4, 1, '2026-02-20 12:00:00.000'),
  (900000002, 4, 3, 2, 1, 1, '2026-02-20 12:00:00.000'),
  (900000003, 0, 0, 0, 0, 1, '2026-02-20 12:00:00.000')
ON DUPLICATE KEY UPDATE cute_count = VALUES(cute_count), cheer_count = VALUES(cheer_count),
  cool_count = VALUES(cool_count), love_count = VALUES(love_count), version = VALUES(version), updated_at = VALUES(updated_at);

INSERT INTO home_badge_definitions (badge_code, display_name, active) VALUES
  ('synthetic-home-badge-a', '합성 홈뱃지 A', TRUE),
  ('synthetic-home-badge-b', '합성 홈뱃지 B', TRUE),
  ('synthetic-home-badge-deleted', '합성 삭제 홈뱃지', TRUE),
  ('synthetic-home-badge-inactive', '합성 비활성 홈뱃지', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = VALUES(active);

DELETE FROM player_badge_assignments WHERE player_id IN (900000001, 900000002, 900000003);
INSERT INTO player_badge_assignments
  (player_id, badge_code, display_value, priority, starts_at, ends_at) VALUES
  (900000001, 'synthetic-home-badge-a', '🏅A', 100, '2026-01-01 00:00:00.000', NULL),
  (900000001, 'synthetic-home-badge-b', '🏅B', 100, '2026-01-01 00:00:00.000', NULL),
  (900000002, 'synthetic-home-badge-deleted', '🏅삭제', 100, '2026-01-01 00:00:00.000', '2026-02-01 00:00:00.000'),
  (900000003, 'synthetic-home-badge-inactive', '🏅비활성', 100, '2026-01-01 00:00:00.000', NULL);

INSERT INTO skill_definitions (id, code, display_name, rules_json, active) VALUES
  (900000001, 'synthetic-skill', '합성 돌진', JSON_OBJECT('power', 10, 'synthetic', TRUE, 'followerBonus', 1000), TRUE),
  (900000002, 'synthetic-follower-skill', '합성 인기', JSON_OBJECT('followerBonus', 2000), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), rules_json = VALUES(rules_json), active = VALUES(active);

INSERT INTO pet_skills (player_pet_id, slot_no, skill_id, level, equipped) VALUES
  (900000001, 1, 900000001, 2, TRUE),
  (900000001, 2, 900000002, 1, TRUE)
ON DUPLICATE KEY UPDATE skill_id = VALUES(skill_id), level = VALUES(level), equipped = VALUES(equipped);
