import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALL_SEE = "\u200b".repeat(500);

export interface PetIntimacyRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  level: bigint;
  fullnessExp: bigint;
}

export interface PetIntimacyRankResult {
  data: string;
  outboxId: string;
  rowCount: number;
  topPlayerId: string | null;
}

// 레거시와 동일하게 인자가 없는 정확한 펫친밀도 순위 명령만 허용합니다.
export function isPetIntimacyRankCommand(message: string | undefined): boolean {
  return message === "/펫친밀도순위";
}

// BIGINT 정밀도를 유지하며 레거시 formatToK의 정수 또는 소수 첫째 자리 k 표기를 만듭니다.
export function formatPetIntimacyFullness(value: bigint): string {
  if (value < 1000n) return value.toString();
  if (value % 1000n === 0n) return `${value / 1000n}k`;
  const roundedTenths = (value + 50n) / 100n;
  return `${roundedTenths / 10n}.${roundedTenths % 10n}k`;
}

// 레거시의 100명 제한, 10명 이후 allsee, 현재 1위의 젖병 표기를 보존합니다.
export function formatPetIntimacyRanking(rows: readonly PetIntimacyRankRow[]): string {
  const header = "🐾 펫친밀도 순위 🐾\n나는 펫에게 먹이를 많이 주는 주인입니다.\n\n";
  if (rows.length === 0) return `${header}표시할 유저가 없습니다.`;
  const lines = rows.slice(0, 100).map((row, index) => {
    const rankDisplay = index === 0 ? `🍼${row.displayName}` : `${row.rankEmoji}${row.displayName}`;
    return `${index + 1}등 [${rankDisplay}] : Lv.${row.level} ( ${formatPetIntimacyFullness(row.fullnessExp)}🍼 )\n`;
  });
  return `${header}${lines.slice(0, 10).join("")}${lines.length > 10 ? ALL_SEE : ""}${lines.slice(10).join("")}`.trim();
}

// 친밀도 projection을 읽고 현재 1위를 원자 갱신한 뒤 감사·실행·outbox를 기록합니다.
export class PetIntimacyRankReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PetIntimacyRankResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetIntimacyRankResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.intimacy_rank_read' AND idempotency_key=? FOR UPDATE",
        [key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string"
          ? JSON.parse(prior[0].result_json) as PetIntimacyRankResult
          : prior[0].result_json;
      }

      const source = await transaction.query<Array<{
        player_id: bigint;
        current_display_name: string;
        rank_emoji: string | null;
        intimacy_level: bigint;
        fullness_exp: bigint;
      }>>(
        `SELECT player.id AS player_id,profile.current_display_name,rank_profile.rank_emoji,
                intimacy.intimacy_level,intimacy.charm AS fullness_exp
           FROM player_pet_intimacy intimacy
           JOIN player_pets pet ON pet.id=intimacy.player_pet_id
           JOIN players player ON player.id=pet.player_id
           JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE player.status='active' AND player.deleted_at IS NULL
          ORDER BY intimacy.intimacy_level DESC,intimacy.charm DESC,
                   profile.current_display_name ASC,player.id ASC
          LIMIT 100 FOR UPDATE`,
      );
      const rows: PetIntimacyRankRow[] = source.map((row) => ({
        playerId: row.player_id.toString(),
        displayName: row.current_display_name,
        rankEmoji: row.rank_emoji ?? "",
        level: BigInt(row.intimacy_level),
        fullnessExp: BigInt(row.fullness_exp),
      }));
      const topPlayerId = rows[0]?.playerId ?? null;
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.intimacy_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key],
      );
      if (topPlayerId !== null) {
        await transaction.execute(
          "INSERT INTO pet_intimacy_ranking_state(state_key,top_player_id,version,updated_at) VALUES ('current',?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE top_player_id=VALUES(top_player_id),version=version+1,updated_at=VALUES(updated_at)",
          [topPlayerId],
        );
      }
      const data = formatPetIntimacyRanking(rows);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_INTIMACY_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',?,'pet.intimacy_rank_read','success','Iris /펫친밀도순위',?,UTC_TIMESTAMP(3))",
        [operation.insertId, topPlayerId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: rows.length, topPlayerId })],
      );
      const result: PetIntimacyRankResult = { data, outboxId: outbox.insertId.toString(), rowCount: rows.length, topPlayerId };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
