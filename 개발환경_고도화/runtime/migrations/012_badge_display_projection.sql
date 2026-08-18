ALTER TABLE player_badge_assignments
  ADD COLUMN display_value VARCHAR(500) NOT NULL AFTER badge_code;
