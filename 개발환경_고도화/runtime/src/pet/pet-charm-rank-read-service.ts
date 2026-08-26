import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALL_SEE = "\u200b".repeat(500);

export interface PetCharmRankRow {
  playerId: string;
  petImage: string;
  petTitle: string;
  petName: string;
  experience: bigint;
  sourceOrder: bigint;
}

export interface PetCharmRankResult {
  data: string;
  outboxId: string;
  rowCount: number;
}

// 레거시와 동일하게 인자가 없는 정확한 펫 매력 순위 명령만 허용합니다.
export function isPetCharmRankCommand(message: string | undefined): boolean {
  return message === "/펫매력순위";
}

// 한 자리 일반 순위 앞에 공백 하나를 추가하는 레거시 표시를 보존합니다.
function rankPrefix(rank: number): string {
  if (rank === 1) return "🥇. ";
  if (rank === 2) return "🥈. ";
  if (rank === 3) return "🥉. ";
  return `${rank < 10 ? " " : ""}${rank}. `;
}

// DB에서 결정된 순서를 상위 10명 allsee 분할과 함께 레거시 메시지로 렌더링합니다.
export function formatPetCharmRanking(rows: readonly PetCharmRankRow[]): string {
  const lines = rows.map((entry, index) =>
    `${rankPrefix(index + 1)}${entry.petImage}${entry.petTitle} ${entry.petName} 💕 ${entry.experience.toLocaleString("en-US")}\n`
  );
  return `🏆 [펫]매력 순위 🏆\n\n${lines.slice(0, 10).join("")}${ALL_SEE}${lines.slice(10).join("")}`;
}

// 활성 펫의 순수 매력 순위를 읽기·감사·outbox transaction으로 제공합니다.
export class PetCharmRankReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PetCharmRankResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetCharmRankResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.charm_rank_read' AND idempotency_key=? FOR UPDATE",
        [key]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string"
          ? JSON.parse(prior[0].result_json) as PetCharmRankResult
          : prior[0].result_json;
      }

      const rows = await transaction.query<Array<{
        player_id: bigint;
        pet_image: string;
        pet_title: string;
        pet_name: string;
        experience: bigint;
        source_order: bigint;
      }>>(
        `SELECT player.id AS player_id,
                COALESCE(pet.image_value,'') AS pet_image,
                COALESCE((SELECT title.display_name
                            FROM pet_titles assignment
                            JOIN title_definitions title ON title.id=assignment.title_id
                           WHERE assignment.player_pet_id=pet.id AND assignment.equipped=TRUE
                           ORDER BY assignment.acquired_at ASC,title.id ASC LIMIT 1),'') AS pet_title,
                COALESCE(pet.display_name,'') AS pet_name,
                pet.experience,
                COALESCE(rank_profile.source_order,player.id) AS source_order
           FROM players player
           JOIN player_pets pet ON pet.player_id=player.id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE player.status='active' AND player.deleted_at IS NULL AND pet.experience>5
          ORDER BY pet.experience DESC,COALESCE(rank_profile.source_order,player.id) ASC,player.id ASC
          FOR UPDATE`
      );
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.charm_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key]
      );
      const mapped = rows.map((value) => ({
        playerId: value.player_id.toString(),
        petImage: value.pet_image,
        petTitle: value.pet_title,
        petName: value.pet_name,
        experience: BigInt(value.experience),
        sourceOrder: BigInt(value.source_order)
      }));
      const data = formatPetCharmRanking(mapped);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_CHARM_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'pet.charm_rank_read','success','Iris /펫매력순위',?,UTC_TIMESTAMP(3))",
        [operation.insertId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: mapped.length, readOnly: true })]
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
