import type { DatabaseTransaction } from "../database.js";

// 신규 회원의 player·프로필·펫·초기 재화·카운터를 한 트랜잭션에 생성합니다.
export async function createInitialPlayer(
  transaction: DatabaseTransaction,
  displayName: string,
  channelId: string
): Promise<bigint> {
  const player = await transaction.execute(
    "INSERT INTO players (status, version, created_at, updated_at) VALUES ('active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))"
  );
  const serverRows = await transaction.query<Array<{ game_server_id: bigint }>>(
    `SELECT mapping.game_server_id FROM channels channel_row
     JOIN channel_server_mappings mapping ON mapping.channel_id = channel_row.id
     WHERE channel_row.external_channel_id = ? AND channel_row.status = 'active'
     ORDER BY CASE WHEN channel_row.provider_code = 'iris' THEN 0 ELSE 1 END, mapping.effective_at DESC LIMIT 1`,
    [channelId]
  );
  await transaction.execute(
    `INSERT INTO player_profiles
      (player_id, current_display_name, joined_at, level, accumulated_level_offset, experience,
       rebirth_count, game_server_id, tier_code, terms_agreed, first_sponsor, version, updated_at)
     VALUES (?, ?, UTC_TIMESTAMP(3), 1, 0, 0, 1, ?, 'seedling', TRUE, FALSE, 1, UTC_TIMESTAMP(3))`,
    [player.insertId, displayName, serverRows[0]?.game_server_id ?? null]
  );
  await transaction.execute(
    "INSERT INTO player_pets (player_id, display_name, pet_type_code, image_value, experience, enhancement_level, version) VALUES (?, NULL, NULL, NULL, 0, 0, 1)",
    [player.insertId]
  );
  await transaction.execute(
    "INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1), (?, 'diamond', 0, 1)",
    [player.insertId, player.insertId]
  );
  await transaction.execute(
    `INSERT INTO player_counters (player_id, counter_code, period_key, value, updated_at) VALUES
      (?, 'attendance', 'lifetime', 0, UTC_TIMESTAMP(3)), (?, 'attendance', 'today', 0, UTC_TIMESTAMP(3)),
      (?, 'like', 'current', 0, UTC_TIMESTAMP(3)), (?, 'like', 'lifetime', 0, UTC_TIMESTAMP(3)),
      (?, 'chat', 'lifetime', 0, UTC_TIMESTAMP(3)), (?, 'explore', 'daily', 0, UTC_TIMESTAMP(3)),
      (?, 'battle_ticket', 'current', 0, UTC_TIMESTAMP(3)), (?, 'battle_score', 'current', 0, UTC_TIMESTAMP(3)),
      (?, 'carrot', 'lifetime', 0, UTC_TIMESTAMP(3)), (?, 'thermo', 'lifetime', 0, UTC_TIMESTAMP(3)),
      (?, 'home_like', 'lifetime', 0, UTC_TIMESTAMP(3))`,
    Array(11).fill(player.insertId)
  );
  return player.insertId;
}
