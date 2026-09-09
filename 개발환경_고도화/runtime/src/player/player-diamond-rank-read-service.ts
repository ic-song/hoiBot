import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALLSEE = "\u200b".repeat(500);

export interface PlayerDiamondRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  grantedDiamond: string;
}

export interface PlayerDiamondRankReadResult {
  data: string;
  outboxId: string;
  rowCount: number;
}

// 레거시와 동일하게 인자가 없는 정확한 다이아 순위 명령만 허용합니다.
export function isPlayerDiamondRankReadCommand(message: string | undefined): boolean {
  return message === "/다이아순위";
}

// 양수 지급 누적 순서를 기존 다이아 순위 UI로 변환합니다.
export function formatPlayerDiamondRanking(rows: readonly PlayerDiamondRankRow[]): string {
  const header = "💎 다이아 순위 💎\n※ 다이아💎 누적기록\n\n";
  if (rows.length === 0) return `${header}아직 다이아💎 기록이 없습니다.`;
  const lines = rows.map((row, index) =>
    `${index === 10 ? ALLSEE : ""}${rankLabel(index + 1)}. ${row.rankEmoji}${row.displayName} - 💎: ${formatInteger(row.grantedDiamond)}`
  );
  return `${header}${lines.join("\n")}`.trim();
}

// 활성 회원의 다이아 양수 ledger 누적을 읽어 감사·outbox와 원자 기록합니다.
export class PlayerDiamondRankReadService {
  constructor(private readonly db: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PlayerDiamondRankReadResult> {
    return this.db.withTransaction(async (transaction) => {
      const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = (await transaction.query<Array<{ result_json: string | PlayerDiamondRankReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='player.diamond_rank_read' AND idempotency_key=? FOR UPDATE", [idempotencyKey]
      ))[0];
      if (prior?.result_json != null) return typeof prior.result_json === "string" ? JSON.parse(prior.result_json) : prior.result_json;

      const rows = await transaction.query<Array<{ player_id: bigint; current_display_name: string; rank_emoji: string | null; granted_diamond: string }>>(
        `SELECT player.id player_id,profile.current_display_name,rank.rank_emoji,ledger.granted_diamond
           FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
           JOIN (
                 SELECT player_id,CAST(CAST(SUM(delta) AS DECIMAL(30,0)) AS CHAR) granted_diamond
                   FROM currency_ledger
                  WHERE currency_code='diamond' AND delta>0
                  GROUP BY player_id
                ) ledger ON ledger.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
          WHERE player.status='active' AND player.deleted_at IS NULL
       ORDER BY CAST(ledger.granted_diamond AS DECIMAL(30,0)) DESC,
                profile.current_display_name COLLATE utf8mb4_bin ASC,
                player.id ASC
       FOR UPDATE`
      );
      const mapped = rows.map((row) => ({ playerId: row.player_id.toString(), displayName: row.current_display_name, rankEmoji: row.rank_emoji ?? "", grantedDiamond: row.granted_diamond }));
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.diamond_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey]
      )).insertId;
      const data = formatPlayerDiamondRanking(mapped);
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_DIAMOND_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'player.diamond_rank_read','success','Iris /다이아순위',?,UTC_TIMESTAMP(3))",
        [operationId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: mapped.length, stableIds: mapped.map((row) => row.playerId), metric: "positive_diamond_ledger", readOnly: true })]
      );
      const result = { data, outboxId: outboxId.toString(), rowCount: mapped.length };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}

function rankLabel(rank: number): string { return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}위`; }
function formatInteger(value: string): string { return BigInt(value.split(".")[0] ?? "0").toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
