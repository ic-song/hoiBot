ALTER TABLE player_attendance
  ADD COLUMN IF NOT EXISTS legacy_source_order INT UNSIGNED NULL AFTER light_enabled,
  ADD INDEX IF NOT EXISTS idx_player_attendance_legacy_list (program_id, period_key, legacy_source_order, player_id);

CREATE OR REPLACE VIEW legacy_attendance_list_projection AS
SELECT
  attendance.period_key,
  attendance.player_id,
  profile.current_display_name AS player_name,
  profile.tier_code,
  COALESCE(attendance.legacy_source_order, attendance.player_id) AS source_order
FROM player_attendance attendance
JOIN attendance_programs program ON program.id = attendance.program_id
JOIN player_profiles profile ON profile.player_id = attendance.player_id
WHERE program.code = 'legacy-daily-attendance';

