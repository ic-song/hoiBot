import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetSkillBagRow {
  code: string;
  displayName: string;
  grade: string;
  quantity: bigint;
}

export interface PetSkillBagReadResult {
  reply: string;
  outboxId: string;
  playerPetId: string | null;
  distinctCount: number;
  totalQuantity: string;
}

// 레거시와 동일하게 인자가 없는 정확한 펫스킬가방 명령만 허용합니다.
export function isPetSkillBagReadCommand(message: string | undefined): boolean {
  return message === "/펫스킬가방";
}

// stable DB 순서의 펫스킬 종류와 BIGINT 수량을 가방 목록으로 표시합니다.
export function formatPetSkillBag(ownerName: string, rows: readonly PetSkillBagRow[]): string {
  const header = `📙 ${ownerName}님의 펫스킬가방 📙\n\n`;
  if (rows.length === 0) return `${header}보유한 펫스킬이 없습니다.`;
  return header + rows.map((row, index) => `${index + 1}. [${row.grade}] ${row.displayName} x${row.quantity}`).join("\n");
}

// 정규화된 펫스킬 가방을 읽고 실행·감사·outbox만 원자 기록합니다.
export class PetSkillBagReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PetSkillBagReadResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetSkillBagReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_bag_read' AND idempotency_key=? FOR UPDATE", [key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as PetSkillBagReadResult : prior[0].result_json;
      }

      const owner = (await transaction.query<Array<{ player_pet_id: bigint | null; owner_name: string }>>(
        `SELECT pet.id player_pet_id,profile.current_display_name owner_name
         FROM external_identities identity_row JOIN players player ON player.id=identity_row.player_id
         JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_pets pet ON pet.player_id=player.id
         WHERE identity_row.provider_code='kakao' AND identity_row.external_user_id=? AND identity_row.status='linked'
         AND player.status='active' AND player.deleted_at IS NULL ORDER BY pet.id LIMIT 1 FOR UPDATE`, [input.externalUserId],
      ))[0];
      let rows: PetSkillBagRow[] = [];
      if (owner?.player_pet_id != null) {
        const source = await transaction.query<Array<{ code: string; display_name: string; grade: string | null; quantity: bigint }>>(
          `SELECT definition.code,definition.display_name,
                  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.grade')),'일반') grade,inventory.quantity
           FROM pet_skill_inventory inventory JOIN skill_definitions definition ON definition.id=inventory.skill_id
           WHERE inventory.player_pet_id=? AND inventory.quantity>0 AND definition.active=TRUE
           ORDER BY definition.display_name,definition.id`, [owner.player_pet_id],
        );
        rows = source.map((row) => ({ code: row.code, displayName: row.display_name, grade: row.grade ?? "일반", quantity: BigInt(row.quantity) }));
      }
      const total = rows.reduce((sum, row) => sum + row.quantity, 0n);
      const reply = formatPetSkillBag(owner?.owner_name ?? "미등록 사용자", rows);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill_bag_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key],
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ data: reply })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_BAG_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'player_pet',?,'pet.skill_bag_read','success','Iris /펫스킬가방',?,UTC_TIMESTAMP(3))",
        [operation.insertId, owner?.player_pet_id ?? null, JSON.stringify({ externalUserId: input.externalUserId, distinctCount: rows.length, totalQuantity: total.toString(), domainMutation: false })],
      );
      const result: PetSkillBagReadResult = { reply, outboxId: outbox.insertId.toString(), playerPetId: owner?.player_pet_id?.toString() ?? null, distinctCount: rows.length, totalQuantity: total.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
