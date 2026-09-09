import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALL_SEE = "\u200b".repeat(500);

export interface PetUpgradeRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  enhancementLevel: bigint;
  sourceOrder: bigint;
}

export interface PetUpgradeRankResult {
  data: string;
  outboxId: string;
  rowCount: number;
}

// 레거시와 동일하게 인자가 없는 정확한 펫 강화 순위 명령만 허용합니다.
export function isPetUpgradeRankCommand(message: string | undefined): boolean {
  return message === "/펫강순위";
}

// 한 자리 일반 순위 앞에 공백 하나를 추가하는 레거시 표시를 보존합니다.
function rankPrefix(rank: number): string {
  if (rank === 1) return "🥇. ";
  if (rank === 2) return "🥈. ";
  if (rank === 3) return "🥉. ";
  return `${rank < 10 ? " " : ""}${rank}. `;
}

// DB에서 결정된 순서를 상위 10명 allsee 분할을 포함한 레거시 메시지로 렌더링합니다.
export function formatPetUpgradeRanking(rows: readonly PetUpgradeRankRow[]): string {
  const lines = rows.map((entry, index) =>
    `${rankPrefix(index + 1)}${entry.rankEmoji}${entry.displayName} - 강화 레벨: ${entry.enhancementLevel.toString()}⭐\n`
  );
  return `🐾 펫 강화 순위 🐾\n\n${lines.slice(0, 10).join("")}${ALL_SEE}${lines.slice(10).join("")}`;
}

// 활성 회원의 펫 강화 순위를 일관된 DB 읽기·감사·outbox transaction으로 제공합니다.
export class PetUpgradeRankReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PetUpgradeRankResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetUpgradeRankResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.upgrade_rank_read' AND idempotency_key=? FOR UPDATE",
        [key]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string"
          ? JSON.parse(prior[0].result_json) as PetUpgradeRankResult
          : prior[0].result_json;
      }

      const rows = await transaction.query<Array<{
        player_id: bigint;
        current_display_name: string;
        rank_emoji: string | null;
        enhancement_level: bigint;
        source_order: bigint;
      }>>(
        `SELECT player.id AS player_id, profile.current_display_name, rank_profile.rank_emoji,
                pet.enhancement_level,
                COALESCE(rank_profile.source_order, player.id) AS source_order
           FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
           JOIN player_pets pet ON pet.player_id=player.id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE player.status='active' AND player.deleted_at IS NULL AND pet.enhancement_level>0
          ORDER BY pet.enhancement_level DESC,
                   CASE WHEN pet.enhancement_updated_at IS NULL THEN 1 ELSE 0 END ASC,
                   pet.enhancement_updated_at ASC,
                   COALESCE(rank_profile.source_order, player.id) ASC,
                   player.id ASC
          FOR UPDATE`
      );
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.upgrade_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key]
      );
      const mapped = rows.map((row) => ({
        playerId: row.player_id.toString(),
        displayName: row.current_display_name,
        rankEmoji: row.rank_emoji ?? "",
        enhancementLevel: BigInt(row.enhancement_level),
        sourceOrder: BigInt(row.source_order)
      }));
      const data = formatPetUpgradeRanking(mapped);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_UPGRADE_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'pet.upgrade_rank_read','success','Iris /펫강순위',?,UTC_TIMESTAMP(3))",
        [operation.insertId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: mapped.length })]
      );
      const result = { data, outboxId: outbox.insertId.toString(), rowCount: mapped.length };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
