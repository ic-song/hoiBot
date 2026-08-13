INSERT INTO game_servers (id, code, display_name, active) VALUES
  (900000001, 'synthetic-server', '합성 테스트 서버', TRUE),
  (900000002, 'synthetic-server-two', '합성 테스트 서버 2', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = VALUES(active);

INSERT INTO channels (id, provider_code, external_channel_id, channel_type, status)
VALUES (900000001, 'synthetic', 'synthetic-room-001', 'group', 'active')
ON DUPLICATE KEY UPDATE channel_type = VALUES(channel_type), status = VALUES(status);

INSERT INTO channel_server_mappings (channel_id, game_server_id, effective_at)
VALUES (900000001, 900000001, '2026-01-01 00:00:00.000')
ON DUPLICATE KEY UPDATE game_server_id = VALUES(game_server_id), effective_at = VALUES(effective_at);

INSERT INTO players (id, status, version) VALUES
  (900000001, 'active', 1),
  (900000002, 'active', 1),
  (900000003, 'active', 1)
ON DUPLICATE KEY UPDATE status = VALUES(status), version = VALUES(version);

INSERT INTO external_identities (id, player_id, provider_code, external_user_id, display_name, status) VALUES
  (900000001, 900000001, 'synthetic', 'synthetic-user-alpha', '테스트알파', 'linked'),
  (900000002, 900000002, 'synthetic', 'synthetic-user-beta', '테스트베타', 'linked'),
  (900000003, 900000003, 'synthetic', 'synthetic-user-gamma', '테스트감마', 'linked'),
  (900000004, 900000001, 'kakao', 'synthetic-admin-alpha', '테스트관리자알파', 'linked'),
  (900000005, 900000003, 'kakao', 'synthetic-non-admin-gamma', '테스트비관리자감마', 'linked'),
  (900000100, NULL, 'kakao', 'synthetic-signup-pending-fixture', '합성대기 남', 'candidate')
ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), display_name = VALUES(display_name), status = VALUES(status);

INSERT INTO pre_signup_attendance (
  id, external_identity_id, legacy_display_name, normalized_display_name, attendance_count,
  last_attended_on, game_server_id, status, migrated_player_id, source_import_run_id, version
) VALUES (
  900000100, 900000100, '합성대기 남', '합성대기 남', 2,
  '2026-01-10', 900000001, 'active', NULL, NULL, 1
)
ON DUPLICATE KEY UPDATE
  external_identity_id = VALUES(external_identity_id), legacy_display_name = VALUES(legacy_display_name),
  normalized_display_name = VALUES(normalized_display_name), attendance_count = VALUES(attendance_count),
  last_attended_on = VALUES(last_attended_on), game_server_id = VALUES(game_server_id),
  status = VALUES(status), migrated_player_id = NULL, source_import_run_id = NULL, version = VALUES(version);

INSERT INTO admin_operators (id, login_id, display_name, password_hash, status) VALUES
  (900000001, 'synthetic-admin-alpha', '합성 테스트 관리자', 'synthetic-disabled-password-hash-not-valid-for-login', 'active')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash), status = VALUES(status);

INSERT INTO admin_operator_roles (operator_id, role_id)
SELECT 900000001, role.id FROM admin_roles role WHERE role.code = 'super_admin'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

INSERT INTO admin_operator_external_identities (operator_id, external_identity_id)
VALUES (900000001, 900000004)
ON DUPLICATE KEY UPDATE operator_id = VALUES(operator_id);

INSERT INTO channel_memberships (channel_id, external_identity_id, status, joined_at) VALUES
  (900000001, 900000001, 'active', '2026-01-01 00:00:00.000'),
  (900000001, 900000002, 'active', '2026-01-01 00:00:00.000'),
  (900000001, 900000003, 'active', '2026-01-01 00:00:00.000')
ON DUPLICATE KEY UPDATE status = VALUES(status), joined_at = VALUES(joined_at);

INSERT INTO player_profiles (
  player_id, current_display_name, joined_at, level, experience, rebirth_count,
  game_server_id, tier_code, terms_agreed, first_sponsor, version
) VALUES
  (900000001, '테스트알파', '2026-01-01 00:00:00.000', 12, 345, 1, 900000001, 'silver', TRUE, TRUE, 1),
  (900000002, '테스트베타', '2026-01-02 00:00:00.000', 8, 120, 0, 900000001, 'bronze', TRUE, FALSE, 1),
  (900000003, '테스트감마', '2026-01-03 00:00:00.000', 3, 15, 0, 900000001, 'starter', TRUE, FALSE, 1)
ON DUPLICATE KEY UPDATE
  current_display_name = VALUES(current_display_name), level = VALUES(level), experience = VALUES(experience),
  rebirth_count = VALUES(rebirth_count), game_server_id = VALUES(game_server_id), tier_code = VALUES(tier_code), version = VALUES(version);

INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES
  (900000001, 'point', 1250.000, 1),
  (900000001, 'diamond', 25.000, 1),
  (900000002, 'point', 800.000, 1),
  (900000002, 'diamond', 5.000, 1),
  (900000003, 'point', 300.000, 1),
  (900000003, 'diamond', 0.000, 1)
ON DUPLICATE KEY UPDATE balance = VALUES(balance), version = VALUES(version);

INSERT INTO player_counters (player_id, counter_code, period_key, value) VALUES
  (900000001, 'message_count', 'lifetime', 42),
  (900000001, 'attendance', 'lifetime', 9),
  (900000001, 'like', 'current', 11),
  (900000001, 'like', 'lifetime', 15),
  (900000001, 'carrot', 'lifetime', 4),
  (900000001, 'thermo', 'lifetime', 2),
  (900000002, 'message_count', 'lifetime', 17),
  (900000003, 'message_count', 'lifetime', 3)
ON DUPLICATE KEY UPDATE value = VALUES(value);

INSERT INTO player_passes (player_id, pass_code, enabled, permanent, starts_at, ends_at) VALUES
  (900000001, 'premium', TRUE, FALSE, '2026-01-01 00:00:00.000', '2027-01-01 00:00:00.000'),
  (900000001, 'support', TRUE, FALSE, '2026-01-01 00:00:00.000', '2027-01-01 00:00:00.000'),
  (900000002, 'support', FALSE, FALSE, NULL, NULL)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), permanent = VALUES(permanent), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at);

INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
  (900000001, 'synthetic-carrot', '합성 당근', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
  (900000002, 'synthetic-potion', '합성 물약', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
  (900000003, 'legacy-pet-name-change-ticket', '펫 이름변경권🎫', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
  (900000004, 'legacy-junk-item', '잡템☠️', 'material', TRUE, JSON_OBJECT('synthetic', TRUE, 'legacyBagOrder', 20), TRUE, 1),
  (900000005, 'legacy-seasoned-chicken', '양념치킨🐔', 'material', TRUE, JSON_OBJECT('synthetic', TRUE, 'legacyBagOrder', 21), TRUE, 1),
  (900000006, 'legacy-castle-battle-reset-ticket', '캐슬대전리셋권🐶', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
  (900000007, 'legacy-raid-strike-seal-600', '레이드타격대인장👑(+600👾)', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
  (900000008, 'legacy-pet-food-box', '펫먹이상자📦(/상자오픈)', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), metadata_json = VALUES(metadata_json), active = VALUES(active), version = VALUES(version);

INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES
  (900000001, 900000001, 20, 1),
  (900000001, 900000002, 3, 1),
  (900000001, 900000003, 2, 1),
  (900000001, 900000004, 20, 1),
  (900000001, 900000005, 12, 1),
  (900000001, 900000006, 0, 1),
  (900000001, 900000007, 0, 1),
  (900000001, 900000008, 0, 1),
  (900000002, 900000001, 7, 1)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = VALUES(version);

INSERT INTO title_definitions (id, code, display_name, scope_code, active) VALUES
  (900000001, 'synthetic-player-title', '합성 개척자', 'player', TRUE),
  (900000002, 'synthetic-pet-title', '합성 탐험가', 'pet', TRUE),
  (900000003, 'synthetic-mini-title', '합성 반짝이', 'mini_pet', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), scope_code = VALUES(scope_code), active = VALUES(active);

INSERT INTO player_titles (player_id, title_id, acquired_at, equipped)
VALUES (900000001, 900000001, '2026-01-04 00:00:00.000', TRUE)
ON DUPLICATE KEY UPDATE acquired_at = VALUES(acquired_at), equipped = VALUES(equipped);

INSERT INTO player_pets
  (id, player_id, display_name, pet_type_code, image_value, joined_on, personality_label,
   experience, enhancement_level, enhancement_updated_at, version) VALUES
  (900000001, 900000001, '합성펫알파', 'synthetic-wolf', '🐺', '2026-01-04', '합성 다정함', 240, 2, '2026-01-05 00:00:00.000', 1),
  (900000002, 900000002, '합성펫베타', 'synthetic-cat', '🐱', '2026-01-05', '합성 씩씩함', 80, 0, NULL, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), pet_type_code = VALUES(pet_type_code),
  image_value = VALUES(image_value), joined_on = VALUES(joined_on), personality_label = VALUES(personality_label),
  experience = VALUES(experience), enhancement_level = VALUES(enhancement_level),
  enhancement_updated_at = VALUES(enhancement_updated_at), version = VALUES(version);

INSERT INTO player_pet_elementals
  (player_pet_id, display_name, grade_code, grade_display_name, enhancement_level, version)
VALUES (900000001, '합성 불새', 'synthetic_king', '합성 정령왕', 3, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), enhancement_level = VALUES(enhancement_level), version = VALUES(version);

INSERT INTO player_pet_pendants
  (player_pet_id, display_name, grade_code, grade_display_name, durability, max_durability,
   enhancement_level, raid_charm, castle_charm, version)
VALUES (900000002, '합성 펜던트', 'synthetic_low', '합성 하급', 9, 10, 1, 100, 100, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code),
  grade_display_name = VALUES(grade_display_name), durability = VALUES(durability),
  max_durability = VALUES(max_durability), enhancement_level = VALUES(enhancement_level),
  raid_charm = VALUES(raid_charm), castle_charm = VALUES(castle_charm), version = VALUES(version);

INSERT INTO player_pet_intimacy (player_pet_id, intimacy_level, progress, charm, version)
VALUES (900000001, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE intimacy_level = VALUES(intimacy_level), progress = VALUES(progress),
  charm = VALUES(charm), version = VALUES(version);

INSERT INTO skill_definitions (id, code, display_name, rules_json, active)
VALUES (900000001, 'synthetic-skill', '합성 돌진', JSON_OBJECT('power', 10, 'synthetic', TRUE), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), rules_json = VALUES(rules_json), active = VALUES(active);

INSERT INTO pet_skills (player_pet_id, slot_no, skill_id, level, equipped)
VALUES (900000001, 1, 900000001, 2, TRUE)
ON DUPLICATE KEY UPDATE skill_id = VALUES(skill_id), level = VALUES(level), equipped = VALUES(equipped);

INSERT INTO pet_skill_inventory (player_pet_id, skill_id, quantity, version, updated_at)
VALUES (900000001, 900000001, 2, 1, '2026-01-05 00:00:00.000')
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = VALUES(version), updated_at = VALUES(updated_at);

INSERT INTO pet_titles (player_pet_id, title_id, acquired_at, equipped)
VALUES (900000001, 900000002, '2026-01-05 00:00:00.000', TRUE)
ON DUPLICATE KEY UPDATE acquired_at = VALUES(acquired_at), equipped = VALUES(equipped);

INSERT INTO mini_pet_definitions (id, code, display_name, grade_code, grade_display_name, emoji_value, active)
VALUES (900000001, 'synthetic-mini-pet', '합성 미니펫', 'rare', '희귀', '✨', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code), grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = VALUES(active);

INSERT INTO owned_mini_pets (id, player_id, mini_pet_definition_id, custom_name, progress, battle_experience, castle_experience, raid_experience, equipped)
VALUES (900000001, 900000001, 900000001, '합성별이', 4, 10, 5, 2, TRUE)
ON DUPLICATE KEY UPDATE custom_name = VALUES(custom_name), progress = VALUES(progress), battle_experience = VALUES(battle_experience), castle_experience = VALUES(castle_experience), raid_experience = VALUES(raid_experience), equipped = VALUES(equipped);

INSERT INTO mini_pet_collection_entries (player_id, mini_pet_definition_id, discovered_count, first_discovered_at)
VALUES (900000001, 900000001, 1, '2026-01-06 00:00:00.000')
ON DUPLICATE KEY UPDATE discovered_count = VALUES(discovered_count), first_discovered_at = VALUES(first_discovered_at);

INSERT INTO mini_pet_title_assignments (owned_mini_pet_id, title_id, acquired_at, equipped)
VALUES (900000001, 900000003, '2026-01-06 00:00:00.000', TRUE)
ON DUPLICATE KEY UPDATE acquired_at = VALUES(acquired_at), equipped = VALUES(equipped);

INSERT INTO player_homes (player_id, display_name, base_experience, like_count, floor_area, version) VALUES
  (900000001, '알파의 합성 홈', 100, 2, 16, 1),
  (900000002, '베타의 합성 홈', 30, 0, 9, 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), base_experience = VALUES(base_experience), like_count = VALUES(like_count), floor_area = VALUES(floor_area), version = VALUES(version);

INSERT INTO player_home_badge_cubes
  (player_id, badge_code, castle_percent, raid_percent, pet_upgrade_percent, explore_percent, equipped, version)
VALUES (900000001, 'synthetic-zero-cube', 0, 0, 0, 0, TRUE, 1)
ON DUPLICATE KEY UPDATE castle_percent = VALUES(castle_percent), raid_percent = VALUES(raid_percent),
  pet_upgrade_percent = VALUES(pet_upgrade_percent), explore_percent = VALUES(explore_percent),
  equipped = VALUES(equipped), version = VALUES(version);

INSERT INTO player_pet_daily_records
  (player_id, record_date, tower_attempts, tower_floor, castle_battle_attempts, castle_battle_score,
   castle_rank_label, mini_battle_attempts, mini_battle_wins, mini_battle_losses,
   explore_attempts, explore_wins, explore_losses, daily_quest_rewarded, weekly_quest_count,
   pet_home_comment_count, feed_post_count, home_alert_open_count, version)
VALUES (900000001, DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)), 0, 0, 0, 0,
  '합성 초보', 0, 0, 0, 0, 0, 0, FALSE, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE tower_attempts = VALUES(tower_attempts), tower_floor = VALUES(tower_floor),
  castle_battle_attempts = VALUES(castle_battle_attempts), castle_battle_score = VALUES(castle_battle_score),
  castle_rank_label = VALUES(castle_rank_label), mini_battle_attempts = VALUES(mini_battle_attempts),
  mini_battle_wins = VALUES(mini_battle_wins), mini_battle_losses = VALUES(mini_battle_losses),
  explore_attempts = VALUES(explore_attempts), explore_wins = VALUES(explore_wins),
  explore_losses = VALUES(explore_losses), daily_quest_rewarded = VALUES(daily_quest_rewarded),
  weekly_quest_count = VALUES(weekly_quest_count), pet_home_comment_count = VALUES(pet_home_comment_count),
  feed_post_count = VALUES(feed_post_count), home_alert_open_count = VALUES(home_alert_open_count), version = VALUES(version);

INSERT INTO furniture_definitions (id, code, display_name, charm_value, active) VALUES
  (900000001, 'synthetic-chair', '합성 의자', 3, TRUE),
  (900000002, 'synthetic-table', '합성 탁자', 5, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), charm_value = VALUES(charm_value), active = VALUES(active);

INSERT INTO owned_furniture (id, player_id, furniture_definition_id, quantity) VALUES
  (900000001, 900000001, 900000001, 2),
  (900000002, 900000001, 900000002, 1)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity);

INSERT INTO furniture_placements (id, player_id, owned_furniture_id, placement_key) VALUES
  (900000001, 900000001, 900000001, 'slot-01'),
  (900000002, 900000001, 900000002, 'slot-02')
ON DUPLICATE KEY UPDATE owned_furniture_id = VALUES(owned_furniture_id);

INSERT INTO home_comments (id, home_player_id, author_player_id, body, status, created_at)
VALUES (900000001, 900000001, 900000002, '합성 방문 댓글입니다.', 'visible', '2026-01-07 00:00:00.000')
ON DUPLICATE KEY UPDATE body = VALUES(body), status = VALUES(status);

INSERT INTO home_visits (id, home_player_id, visitor_player_id, visited_at)
VALUES (900000001, 900000001, 900000002, '2026-01-07 00:00:00.000')
ON DUPLICATE KEY UPDATE visited_at = VALUES(visited_at);

INSERT INTO home_reactions (home_player_id, actor_player_id, reaction_code, created_at)
VALUES (900000001, 900000002, 'like', '2026-01-07 00:00:00.000')
ON DUPLICATE KEY UPDATE created_at = VALUES(created_at);

INSERT INTO guilds (id, code, display_name, mark, status, version) VALUES
  (900000001, 'synthetic-guild-alpha', '합성 알파 길드', 'A', 'active', 1),
  (900000002, 'synthetic-guild-beta', '합성 베타 길드', 'B', 'active', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), mark = VALUES(mark), status = VALUES(status), version = VALUES(version);

INSERT INTO guild_members (guild_id, player_id, role_code, joined_at) VALUES
  (900000001, 900000001, 'leader', '2026-01-01 00:00:00.000'),
  (900000001, 900000002, 'member', '2026-01-02 00:00:00.000'),
  (900000002, 900000003, 'leader', '2026-01-03 00:00:00.000')
ON DUPLICATE KEY UPDATE role_code = VALUES(role_code), joined_at = VALUES(joined_at);

INSERT INTO guild_resource_accounts (guild_id, currency_code, balance, version)
VALUES (900000001, 'point', 5000.000, 1)
ON DUPLICATE KEY UPDATE balance = VALUES(balance), version = VALUES(version);

INSERT INTO guild_warehouse_stacks (guild_id, item_id, quantity, version)
VALUES (900000001, 900000001, 50, 1)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = VALUES(version);

INSERT INTO attendance_programs (id, code, display_name, reset_policy_code, reward_rules_json, active)
VALUES (900000001, 'synthetic-daily', '합성 일일 출석', 'daily', JSON_OBJECT('point', 10, 'synthetic', TRUE), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), reward_rules_json = VALUES(reward_rules_json), active = VALUES(active);

INSERT INTO player_attendance (player_id, program_id, period_key, attendance_count, last_attended_at, light_enabled, version) VALUES
  (900000001, 900000001, '2026-01', 5, '2026-01-07 00:00:00.000', TRUE, 1),
  (900000002, 900000001, '2026-01', 2, '2026-01-06 00:00:00.000', FALSE, 1)
ON DUPLICATE KEY UPDATE attendance_count = VALUES(attendance_count), last_attended_at = VALUES(last_attended_at), light_enabled = VALUES(light_enabled), version = VALUES(version);

INSERT INTO community_boards (id, code, display_name, channel_id, board_type_code, active) VALUES
  (900000001, 'synthetic-board', '합성 게시판', 900000001, 'general', TRUE),
  (900000002, 'synthetic-carrot-board', '합성 당근 게시판', 900000001, 'carrot', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), channel_id = VALUES(channel_id), board_type_code = VALUES(board_type_code), active = VALUES(active);

INSERT INTO community_posts (id, board_id, author_player_id, post_type_code, title, body, status, created_at) VALUES
  (900000001, 900000001, 900000001, 'message', '합성 공지', '합성 게시글 본문입니다.', 'published', '2026-01-08 00:00:00.000'),
  (900000002, 900000002, 900000002, 'trade', '합성 당근 교환', '합성 당근 1개를 교환합니다.', 'published', '2026-01-08 00:01:00.000')
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), status = VALUES(status);

INSERT INTO castle_battle_seasons (id, season_key, status, defending_guild_id, starts_at, ends_at, version)
VALUES (900000001, 'synthetic-2026-01', 'active', 900000001, '2026-01-01 00:00:00.000', '2026-01-31 23:59:59.000', 1)
ON DUPLICATE KEY UPDATE status = VALUES(status), defending_guild_id = VALUES(defending_guild_id), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at), version = VALUES(version);

INSERT INTO castle_battle_participants (season_id, guild_id, score, rank_no, state_code) VALUES
  (900000001, 900000001, 1200.000, 1, 'registered'),
  (900000001, 900000002, 800.000, 2, 'registered')
ON DUPLICATE KEY UPDATE score = VALUES(score), rank_no = VALUES(rank_no), state_code = VALUES(state_code);

INSERT INTO package_definitions (id, code, display_name, price_currency_code, price_amount, purchase_limit, starts_at, ends_at, active)
VALUES (900000001, 'synthetic-starter-package', '합성 스타터 패키지', 'point', 100.000, 1, '2026-01-01 00:00:00.000', '2027-01-01 00:00:00.000', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), price_currency_code = VALUES(price_currency_code), price_amount = VALUES(price_amount), purchase_limit = VALUES(purchase_limit), active = VALUES(active);

INSERT INTO package_contents (package_id, sequence_no, asset_type_code, asset_code, quantity) VALUES
  (900000001, 1, 'item', 'synthetic-carrot', 5.000),
  (900000001, 2, 'currency', 'diamond', 1.000)
ON DUPLICATE KEY UPDATE asset_type_code = VALUES(asset_type_code), asset_code = VALUES(asset_code), quantity = VALUES(quantity);

INSERT INTO operations (id, operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, completed_at) VALUES
  (900000001, '90000000-0000-4000-8000-000000000001', 'synthetic-fixture', 'package-purchase-alpha', 'player', 900000001, 'synthetic', 'completed', JSON_OBJECT('synthetic', TRUE), '2026-01-09 00:00:00.000'),
  (900000002, '90000000-0000-4000-8000-000000000002', 'synthetic-fixture', 'currency-alpha', 'system', NULL, 'synthetic', 'completed', JSON_OBJECT('synthetic', TRUE), '2026-01-09 00:01:00.000'),
  (900000003, '90000000-0000-4000-8000-000000000003', 'synthetic-fixture', 'inventory-alpha', 'system', NULL, 'synthetic', 'completed', JSON_OBJECT('synthetic', TRUE), '2026-01-09 00:02:00.000'),
  (900000004, '90000000-0000-4000-8000-000000000004', 'synthetic-fixture', 'home-activity-alpha', 'player', 900000002, 'synthetic', 'completed', JSON_OBJECT('synthetic', TRUE), '2026-01-09 00:03:00.000')
ON DUPLICATE KEY UPDATE status = VALUES(status), result_json = VALUES(result_json), completed_at = VALUES(completed_at);

INSERT INTO package_purchases (id, operation_id, package_id, player_id, quantity, purchased_at)
VALUES (900000001, 900000001, 900000001, 900000001, 1, '2026-01-09 00:00:00.000')
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), purchased_at = VALUES(purchased_at);

INSERT INTO currency_ledger (id, operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code, created_at)
VALUES (900000001, 900000002, 1, 900000001, 'point', 50.000, 1250.000, 'synthetic_seed', '2026-01-09 00:01:00.000')
ON DUPLICATE KEY UPDATE delta = VALUES(delta), balance_after = VALUES(balance_after), reason_code = VALUES(reason_code);

INSERT INTO inventory_ledger (id, operation_id, sequence_no, player_id, item_id, instance_id, quantity_delta, reason_code, created_at)
VALUES (900000001, 900000003, 1, 900000001, 900000001, NULL, 5, 'synthetic_seed', '2026-01-09 00:02:00.000')
ON DUPLICATE KEY UPDATE quantity_delta = VALUES(quantity_delta), reason_code = VALUES(reason_code);

INSERT INTO home_activity_events (id, operation_id, home_player_id, actor_player_id, activity_code, reference_id, detail_json, created_at)
VALUES (900000001, 900000004, 900000001, 900000002, 'visit', 900000001, JSON_OBJECT('synthetic', TRUE), '2026-01-09 00:03:00.000')
ON DUPLICATE KEY UPDATE activity_code = VALUES(activity_code), reference_id = VALUES(reference_id), detail_json = VALUES(detail_json);

INSERT INTO pet_expedition_definitions (id, code, display_name, duration_seconds, requirements_json, rewards_json, active)
VALUES (900000001, 'synthetic-forest', '합성 숲 탐험', 3600, JSON_OBJECT('level', 1), JSON_OBJECT('point', 20), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), duration_seconds = VALUES(duration_seconds), requirements_json = VALUES(requirements_json), rewards_json = VALUES(rewards_json), active = VALUES(active);

INSERT INTO pet_expedition_runs (id, player_pet_id, expedition_id, operation_id, status, started_at, completes_at, claimed_at, result_json, version)
VALUES (900000001, 900000001, 900000001, NULL, 'completed', '2026-01-10 00:00:00.000', '2026-01-10 01:00:00.000', '2026-01-10 01:01:00.000', JSON_OBJECT('point', 20, 'synthetic', TRUE), 1)
ON DUPLICATE KEY UPDATE status = VALUES(status), started_at = VALUES(started_at), completes_at = VALUES(completes_at), claimed_at = VALUES(claimed_at), result_json = VALUES(result_json), version = VALUES(version);

INSERT INTO event_seasons (id, code, display_name, starts_at, ends_at, status)
VALUES (900000001, 'synthetic-season', '합성 시즌', '2026-01-01 00:00:00.000', '2026-12-31 23:59:59.000', 'active')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at), status = VALUES(status);

INSERT INTO game_mode_definitions (id, code, display_name, rules_json, active)
VALUES (900000001, 'synthetic-punch', '합성 펀치', JSON_OBJECT('synthetic', TRUE), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), rules_json = VALUES(rules_json), active = VALUES(active);

INSERT INTO player_event_progress (season_id, mode_id, player_id, progress_json, version) VALUES
  (900000001, 900000001, 900000001, JSON_OBJECT('score', 700, 'synthetic', TRUE), 1),
  (900000001, 900000001, 900000002, JSON_OBJECT('score', 500, 'synthetic', TRUE), 1)
ON DUPLICATE KEY UPDATE progress_json = VALUES(progress_json), version = VALUES(version);

INSERT INTO leaderboards (id, code, season_key, calculated_at)
VALUES
  (900000001, 'synthetic-punch', 'synthetic-season', '2026-01-10 02:00:00.000'),
  (900000002, 'home_like', 'lifetime', '2026-01-10 02:00:00.000'),
  (900000003, 'carrot', 'lifetime', '2026-01-10 02:00:00.000'),
  (900000004, 'thermo', 'lifetime', '2026-01-10 02:00:00.000')
ON DUPLICATE KEY UPDATE calculated_at = VALUES(calculated_at);

INSERT INTO leaderboard_entries (leaderboard_id, player_id, rank_no, score, tie_break_key) VALUES
  (900000001, 900000001, 1, 700.000, '001'),
  (900000001, 900000002, 2, 500.000, '002'),
  (900000002, 900000001, 1, 2.000, '001'),
  (900000003, 900000001, 2, 4.000, '001'),
  (900000004, 900000001, 3, 2.000, '001')
ON DUPLICATE KEY UPDATE rank_no = VALUES(rank_no), score = VALUES(score), tie_break_key = VALUES(tie_break_key);

INSERT INTO tower_definitions (id, code, display_name, season_key, rules_json, active)
VALUES (900000001, 'synthetic-trial-tower', '합성 시련탑', 'synthetic-season', JSON_OBJECT('maxFloor', 100, 'synthetic', TRUE), TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), season_key = VALUES(season_key), rules_json = VALUES(rules_json), active = VALUES(active);

INSERT INTO player_tower_progress (tower_id, player_id, highest_floor, current_floor, attempt_count, last_attempt_at, progress_json, version) VALUES
  (900000001, 900000001, 12, 10, 4, '2026-01-10 03:00:00.000', JSON_OBJECT('synthetic', TRUE), 1),
  (900000001, 900000002, 5, 5, 2, '2026-01-10 03:05:00.000', JSON_OBJECT('synthetic', TRUE), 1)
ON DUPLICATE KEY UPDATE highest_floor = VALUES(highest_floor), current_floor = VALUES(current_floor), attempt_count = VALUES(attempt_count), last_attempt_at = VALUES(last_attempt_at), progress_json = VALUES(progress_json), version = VALUES(version);

INSERT INTO market_listings (id, seller_player_id, asset_type_code, item_id, inventory_instance_id, quantity, price_currency_code, price_amount, status, version, created_at, expires_at)
VALUES (900000001, 900000001, 'item', 900000001, NULL, 2, 'point', 40.000, 'open', 1, '2026-01-10 04:00:00.000', '2027-01-10 04:00:00.000')
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), price_amount = VALUES(price_amount), status = VALUES(status), version = VALUES(version), expires_at = VALUES(expires_at);

INSERT INTO bag_integrity_checks (id, player_id, source_checksum, issue_count, checked_at, detail_json)
VALUES (900000001, 900000001, REPEAT('0', 64), 0, '2026-01-10 05:00:00.000', JSON_OBJECT('synthetic', TRUE))
ON DUPLICATE KEY UPDATE issue_count = VALUES(issue_count), checked_at = VALUES(checked_at), detail_json = VALUES(detail_json);

INSERT INTO request_monitor_policies (id, policy_key, channel_id, enabled, observation_mode, retention_days, rule_json, version)
VALUES (900000001, 'synthetic-monitor-policy', 900000001, TRUE, 'designated_only', 7, JSON_OBJECT('synthetic', TRUE), 1)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), observation_mode = VALUES(observation_mode), retention_days = VALUES(retention_days), rule_json = VALUES(rule_json), version = VALUES(version);

INSERT INTO configuration_sets (id, set_code, version, status, effective_from)
VALUES (900000001, 'synthetic-functional-fixture', 1, 'active', '2026-01-01 00:00:00.000')
ON DUPLICATE KEY UPDATE status = VALUES(status), effective_from = VALUES(effective_from);

INSERT INTO configuration_values (configuration_set_id, config_key, value_type, string_value)
VALUES (900000001, 'fixture.version', 'string', 'functional-v1')
ON DUPLICATE KEY UPDATE value_type = VALUES(value_type), string_value = VALUES(string_value), decimal_value = NULL, integer_value = NULL, boolean_value = NULL, json_value = NULL;

INSERT INTO configuration_values (configuration_set_id, config_key, value_type, string_value)
VALUES (900000001, 'legacy.bag.advertisement', 'string', '합성 가방 광고')
ON DUPLICATE KEY UPDATE value_type = VALUES(value_type), string_value = VALUES(string_value), decimal_value = NULL, integer_value = NULL, boolean_value = NULL, json_value = NULL;
