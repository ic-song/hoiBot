import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALLSEE = "\u200b".repeat(500);

export interface HomeRankingRow {
  owner: string;
  houseName: string;
  experience: bigint;
  floorArea: bigint;
  stableId: string;
}

export interface HomeRankingResult {
  data: string;
  outboxId: string;
  rowCount: number;
}

// 레거시와 동일하게 인자가 없는 정확한 펫홈 순위 명령만 허용합니다.
export function isHomeRankingReadCommand(message: string | undefined): boolean {
  return message === "/펫홈순위";
}

// DB에서 확정한 평수·한글 이름 순서를 레거시 메시지와 11위 접힘 경계로 투영합니다.
export function formatHomeRanking(rows: readonly HomeRankingRow[]): string {
  const lines = rows.map((row, index) =>
    `${index === 10 ? ALLSEE : ""}${index + 1}위 [${row.owner}] : 🏡 ${row.houseName}(+${row.experience.toString()}💕)[+${row.floorArea.toString()}평] `
  );
  return `🏡 펫스윗홈 순위 🏡\n따라 따라 다~🎵 따라 라리 라라~🎵\n(펫스윗 홈의 평수 순위입니다)\n\n${lines.join("\n")}`.trim();
}

// 모든 활성 펫홈의 평수 순위를 읽기·감사·outbox transaction으로 제공합니다.
export class HomeRankingReadService {
  constructor(private readonly db: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeRankingResult> {
    return this.db.withTransaction(async (transaction) => {
      const idempotencyKey = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = (await transaction.query<Array<{ result_json: string | HomeRankingResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.ranking_read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (prior?.result_json != null) {
        return typeof prior.result_json === "string" ? JSON.parse(prior.result_json) : prior.result_json;
      }

      const rows = await transaction.query<Array<{
        player_id: bigint;
        owner_name: string;
        rank_emoji: string | null;
        house_name: string;
        base_experience: bigint;
        floor_area: bigint;
      }>>(
        `SELECT home.player_id,
                profile.current_display_name owner_name,
                rank.rank_emoji,
                COALESCE(home.display_name,'') house_name,
                home.base_experience,
                home.floor_area
           FROM player_homes home
           JOIN players player ON player.id=home.player_id AND player.status='active' AND player.deleted_at IS NULL
           JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
       ORDER BY home.floor_area DESC,
                profile.current_display_name COLLATE utf8mb4_unicode_ci ASC,
                home.player_id ASC
       FOR UPDATE`
      );
      const mapped = rows.map((row) => ({
        owner: `${row.rank_emoji ?? ""}${row.owner_name}`,
        houseName: row.house_name,
        experience: BigInt(row.base_experience),
        floorArea: BigInt(row.floor_area),
        stableId: row.player_id.toString()
      }));
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.ranking_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey]
      )).insertId;
      const data = formatHomeRanking(mapped);
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_RANKING_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'home.ranking_read','success','Iris /펫홈순위',?,UTC_TIMESTAMP(3))",
        [operationId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: mapped.length, stableIds: mapped.map((row) => row.stableId), readOnly: true })]
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
