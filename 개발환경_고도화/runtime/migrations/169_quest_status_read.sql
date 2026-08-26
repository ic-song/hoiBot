ALTER TABLE player_pet_daily_records
  ADD COLUMN IF NOT EXISTS pass_daily_quest_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS premium_daily_quest_rewarded BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE VIEW legacy_quest_status_projection AS
SELECT identity_row.provider_code,
       identity_row.external_user_id,
       player.id AS player_id,
       profile.current_display_name AS display_name,
       COALESCE(daily.tower_attempts, 0) AS tower_attempts,
       COALESCE(daily.castle_battle_attempts, 0) AS castle_battle_attempts,
       COALESCE(daily.mini_battle_attempts, 0) AS mini_battle_attempts,
       COALESCE(daily.explore_attempts, 0) AS explore_attempts,
       COALESCE(daily.weekly_quest_count, 0) AS weekly_quest_count,
       COALESCE(daily.daily_quest_rewarded, FALSE) AS daily_quest_rewarded,
       COALESCE(daily.pet_home_comment_count, 0) AS pet_home_comment_count,
       COALESCE(daily.feed_post_count, 0) AS feed_post_count,
       COALESCE(daily.home_alert_open_count, 0) AS home_alert_open_count,
       COALESCE(daily.pass_daily_quest_rewarded, FALSE) AS pass_daily_quest_rewarded,
       COALESCE(daily.premium_daily_quest_rewarded, FALSE) AS premium_daily_quest_rewarded,
       EXISTS(
         SELECT 1 FROM player_passes pass_row
         WHERE pass_row.player_id = player.id
           AND pass_row.enabled = TRUE
           AND pass_row.pass_code IN ('support', 'beginner')
           AND (pass_row.permanent = TRUE OR pass_row.ends_at >= UTC_TIMESTAMP(3))
       ) AS has_base_pass,
       EXISTS(
         SELECT 1 FROM player_passes pass_row
         WHERE pass_row.player_id = player.id
           AND pass_row.enabled = TRUE
           AND pass_row.pass_code = 'premium'
           AND (pass_row.permanent = TRUE OR pass_row.ends_at >= UTC_TIMESTAMP(3))
       ) AS has_premium_pass
FROM external_identities identity_row
JOIN players player ON player.id = identity_row.player_id AND player.status = 'active'
JOIN player_profiles profile ON profile.player_id = player.id
LEFT JOIN player_pet_daily_records daily
  ON daily.player_id = player.id
 AND daily.record_date = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR))
WHERE identity_row.status = 'linked';

INSERT INTO command_registry(command_code, handler_key, auth_scope, rollout_state, enabled, version)
VALUES ('QUEST_STATUS_READ', 'quest_status_read', 'VERIFIED_USER', 'SHADOW', 1, 1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key), auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state), enabled=VALUES(enabled), version=VALUES(version);

INSERT INTO command_aliases(command_text, command_code, active)
VALUES ('/퀘스트', 'QUEST_STATUS_READ', 1),
       ('ㄹㄹㄹ', 'QUEST_STATUS_READ', 1),
       ('/ㅋ', 'QUEST_STATUS_READ', 1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code), active=VALUES(active);
