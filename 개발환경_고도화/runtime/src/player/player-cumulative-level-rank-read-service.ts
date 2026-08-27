import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALLSEE = "\u200b".repeat(500);

export interface PlayerCumulativeLevelRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  totalLevel: string;
}

export interface PlayerCumulativeLevelRankReadResult {
  data: string;
  outboxId: string;
  rowCount: number;
}

// 레거시와 동일하게 인자가 없는 정확한 누적 레벨 순위 명령만 허용합니다.
export function isPlayerCumulativeLevelRankReadCommand(message: string | undefined): boolean {
  return message === "/누렙순위";
}

// DB가 확정한 순서를 기존 순위 이모지와 10명 접힘 UI로 변환합니다.
export function formatPlayerCumulativeLevelRanking(rows: readonly PlayerCumulativeLevelRankRow[]): string {
  const lines = rows.map((row, index) =>
    `${rankLabel(index + 1)}${row.rankEmoji}${row.displayName} - LV.${row.totalLevel}\n`
  );
  return `🏆 누적 레벨 순위 🏆\n\n${lines.slice(0, 10).join("")}${ALLSEE}${lines.slice(10).join("")}`;
}

// 활성 회원의 현재 레벨과 누적 오프셋을 읽어 감사·outbox와 함께 원자 기록합니다.
export class PlayerCumulativeLevelRankReadService {
  constructor(private readonly db: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PlayerCumulativeLevelRankReadResult> {
    return this.db.withTransaction(async (transaction) => {
      const idempotencyKey = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = (await transaction.query<Array<{ result_json: string | PlayerCumulativeLevelRankReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='player.cumulative_level_rank_read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (prior?.result_json != null) {
        return typeof prior.result_json === "string" ? JSON.parse(prior.result_json) : prior.result_json;
      }

      const rows = await transaction.query<Array<{
        player_id: bigint;
        current_display_name: string;
        rank_emoji: string | null;
        total_level: string;
      }>>(
        `SELECT player.id player_id,
                profile.current_display_name,
                rank.rank_emoji,
                CAST(CAST(profile.level AS DECIMAL(30,0)) + CAST(profile.accumulated_level_offset AS DECIMAL(30,0)) AS CHAR) total_level
           FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
          WHERE player.status='active' AND player.deleted_at IS NULL
       ORDER BY CAST(profile.level AS DECIMAL(30,0)) + CAST(profile.accumulated_level_offset AS DECIMAL(30,0)) DESC,
                COALESCE(rank.source_order, 18446744073709551615) ASC,
                player.id ASC
       FOR UPDATE`
      );
      const mapped = rows.map((row) => ({
        playerId: row.player_id.toString(),
        displayName: row.current_display_name,
        rankEmoji: row.rank_emoji ?? "",
        totalLevel: row.total_level
      }));
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.cumulative_level_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey]
      )).insertId;
      const data = formatPlayerCumulativeLevelRanking(mapped);
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_CUMULATIVE_LEVEL_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'player.cumulative_level_rank_read','success','Iris /누렙순위',?,UTC_TIMESTAMP(3))",
        [operationId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: mapped.length, stableIds: mapped.map((row) => row.playerId), readOnly: true })]
      );
      const result = { data, outboxId: outboxId.toString(), rowCount: mapped.length };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operationId]
      );
      return result;
    });
  }
}

function rankLabel(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}위 `;
}
