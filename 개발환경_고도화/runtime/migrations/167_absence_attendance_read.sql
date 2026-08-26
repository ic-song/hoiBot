INSERT INTO attendance_programs (code, display_name, reset_policy_code, reward_rules_json, active)
VALUES ('legacy-daily-attendance', '레거시 일일 출석', 'lifetime', NULL, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), reset_policy_code = VALUES(reset_policy_code), active = TRUE;

CREATE OR REPLACE VIEW legacy_absence_attendance_projection AS
SELECT
  player.id AS source_order,
  profile.current_display_name AS player_name,
  COALESCE(
    MAX(CASE
      WHEN program.code = 'legacy-daily-attendance'
      THEN DATE_FORMAT(attendance.last_attended_at, '%Y%m%d')
      ELSE NULL
    END),
    ''
  ) AS recent_yyyymmdd
FROM players player
JOIN player_profiles profile ON profile.player_id = player.id
LEFT JOIN player_attendance attendance ON attendance.player_id = player.id
LEFT JOIN attendance_programs program ON program.id = attendance.program_id
GROUP BY player.id, profile.current_display_name;

