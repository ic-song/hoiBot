import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALLSEE = "\u200b".repeat(500);

export interface PlayerChatRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  chatCount: string;
}

export interface PlayerChatRankReadResult {
  data: string;
  outboxId: string;
  rowCount: number;
  topPlayerId: string | null;
  topChatCount: string | null;
}

// 레거시와 동일하게 인자가 없는 정확한 채팅 순위 명령만 허용합니다.
export function isPlayerChatRankReadCommand(message: string | undefined): boolean {
  return message === "/채팅순위";
}

// DB 순서를 레거시 채팅 순위 UI와 10위 allsee 경계로 변환합니다.
export function formatPlayerChatRanking(rows: readonly PlayerChatRankRow[], historySinceDisplay: string): string {
  const header = `🏆 채팅 순위 🏆\n[${historySinceDisplay} 이후 채팅 이력 기준]\n`;
  const lines = rows.map((row, index) => `${index === 10 ? ALLSEE : ""}${rankLabel(index + 1)}. ${row.rankEmoji}${row.displayName} - 채팅수: ${commas(BigInt(row.chatCount))}`);
  return `${header}${lines.join("\n")}`.trim();
}

// 채팅 카운터 순위와 stable 1위 snapshot을 감사·outbox와 원자 기록합니다.
export class PlayerChatRankReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PlayerChatRankReadResult> {
    return this.database.withTransaction(async (transaction) => {
      const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = (await transaction.query<Array<{ result_json: string | PlayerChatRankReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='player.chat_rank_read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (prior?.result_json != null) return typeof prior.result_json === "string" ? JSON.parse(prior.result_json) : prior.result_json;

      const setting = (await transaction.query<Array<{ history_since_display: string }>>(
        "SELECT history_since_display FROM player_chat_rank_settings WHERE singleton_key=1 FOR UPDATE"
      ))[0];
      if (setting === undefined) throw new Error("Chat rank history setting is missing.");
      const rows = await transaction.query<Array<{ player_id: bigint; current_display_name: string; rank_emoji: string | null; chat_count: bigint }>>(
        `SELECT player.id player_id,profile.current_display_name,rank_profile.rank_emoji,COALESCE(counter.value,0) chat_count
           FROM players player JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
      LEFT JOIN player_counters counter ON counter.player_id=player.id AND counter.counter_code='chatcnt0' AND counter.period_key='current'
          WHERE player.status='active' AND player.deleted_at IS NULL
          ORDER BY chat_count DESC,(rank_profile.source_order IS NULL),rank_profile.source_order,player.id FOR UPDATE`
      );
      const mapped = rows.map((row) => ({ playerId: row.player_id.toString(), displayName: row.current_display_name, rankEmoji: row.rank_emoji ?? "", chatCount: row.chat_count.toString() }));
      const top = mapped[0];
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.chat_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey]
      )).insertId;
      if (top !== undefined) {
        await transaction.execute(
          "INSERT INTO player_chat_rank_snapshots(singleton_key,top_player_id,top_chat_count,source_event_id,updated_at) VALUES(1,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE top_player_id=VALUES(top_player_id),top_chat_count=VALUES(top_chat_count),source_event_id=VALUES(source_event_id),updated_at=VALUES(updated_at)",
          [top.playerId, top.chatCount, input.eventId]
        );
      }
      const data = formatPlayerChatRanking(mapped, setting.history_since_display);
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_CHAT_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'player.chat_rank_read','success','Iris /채팅순위',?,UTC_TIMESTAMP(3))",
        [operationId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: mapped.length, stableIds: mapped.map((row) => row.playerId), topPlayerId: top?.playerId ?? null, topChatCount: top?.chatCount ?? null, projectionUpdated: top !== undefined, sourceCheckcntMapped: setting.history_since_display })]
      );
      const result = { data, outboxId: outboxId.toString(), rowCount: mapped.length, topPlayerId: top?.playerId ?? null, topChatCount: top?.chatCount ?? null };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}

function rankLabel(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}위`;
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
