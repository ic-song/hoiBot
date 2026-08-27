import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetSkillViewRow {
  code: string;
  displayName: string;
  grade: string;
  level: bigint;
  quantity: bigint;
  slotNo: number | null;
}

export interface PetSkillReadResult {
  reply: string;
  outboxId: string;
  playerPetId: string | null;
  equippedCount: number;
  inventoryCount: number;
  slotLimit: number;
}

// 레거시와 동일하게 인자가 없는 정확한 펫스킬 조회 명령만 허용합니다.
export function isPetSkillReadCommand(message: string | undefined): boolean {
  return message === "/펫스킬";
}

// 친밀도 100레벨당 1칸, 최대 30칸과 학개론 장착 보너스 3칸을 계산합니다.
export function calculatePetSkillSlotLimit(intimacyLevel: bigint, hasTextbook: boolean): number {
  const base = intimacyLevel / 100n > 30n ? 30 : Number(intimacyLevel / 100n);
  return base + (hasTextbook ? 3 : 0);
}

// 장착 순서와 가방 수량을 분리해 펫스킬 현황 메시지를 만듭니다.
export function formatPetSkillStatus(input: {
  ownerName: string;
  petName: string;
  intimacyLevel: bigint;
  equipped: readonly PetSkillViewRow[];
  inventory: readonly PetSkillViewRow[];
}): { reply: string; slotLimit: number } {
  const hasTextbook = input.equipped.some((skill) => skill.displayName.replace(/\s/g, "").includes("펫스킬학개론"));
  const slotLimit = calculatePetSkillSlotLimit(input.intimacyLevel, hasTextbook);
  const equipped = input.equipped.length === 0
    ? "장착된 펫스킬이 없습니다."
    : input.equipped.map((skill) => `${skill.slotNo}. [${skill.grade}] ${skill.displayName} Lv.${skill.level}`).join("\n");
  const inventory = input.inventory.length === 0
    ? "보유한 펫스킬이 없습니다."
    : input.inventory.map((skill, index) => `${index + 1}. [${skill.grade}] ${skill.displayName} x${skill.quantity}`).join("\n");
  return {
    reply: `🐾 ${input.ownerName}님의 펫스킬 🐾\n${input.petName}\n장착 슬롯 ${input.equipped.length}/${slotLimit}\n\n[장착 스킬]\n${equipped}\n\n[펫스킬 가방]\n${inventory}`,
    slotLimit,
  };
}

// 정규화된 펫·스킬 projection을 읽고 실행·감사·outbox만 원자 기록합니다.
export class PetSkillReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PetSkillReadResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetSkillReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_read' AND idempotency_key=? FOR UPDATE",
        [key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string"
          ? JSON.parse(prior[0].result_json) as PetSkillReadResult
          : prior[0].result_json;
      }

      const pets = await transaction.query<Array<{
        player_pet_id: bigint;
        owner_name: string;
        pet_name: string;
        intimacy_level: bigint;
      }>>(
        `SELECT pet.id AS player_pet_id,profile.current_display_name AS owner_name,
                pet.display_name AS pet_name,COALESCE(intimacy.intimacy_level,0) AS intimacy_level
           FROM external_identities identity_row
           JOIN players player ON player.id=identity_row.player_id
           JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN player_pets pet ON pet.player_id=player.id
           LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id
          WHERE identity_row.provider_code='iris' AND identity_row.external_user_id=?
            AND identity_row.status='linked' AND player.status='active' AND player.deleted_at IS NULL
          ORDER BY pet.id ASC LIMIT 1 FOR UPDATE`,
        [input.externalUserId],
      );
      const pet = pets[0];
      let reply = "등록된 펫이 없습니다.";
      let equipped: PetSkillViewRow[] = [];
      let inventory: PetSkillViewRow[] = [];
      let slotLimit = 0;
      if (pet?.player_pet_id != null) {
        const equippedRows = await transaction.query<Array<{
          code: string; display_name: string; grade: string | null; level: bigint; slot_no: number;
        }>>(
          `SELECT definition.code,definition.display_name,
                  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.grade')),'일반') AS grade,
                  skill.level,skill.slot_no
             FROM pet_skills skill
             JOIN skill_definitions definition ON definition.id=skill.skill_id
            WHERE skill.player_pet_id=? AND skill.equipped=TRUE AND definition.active=TRUE
            ORDER BY skill.slot_no ASC`,
          [pet.player_pet_id],
        );
        const inventoryRows = await transaction.query<Array<{
          code: string; display_name: string; grade: string | null; quantity: bigint;
        }>>(
          `SELECT definition.code,definition.display_name,
                  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.grade')),'일반') AS grade,
                  inventory.quantity
             FROM pet_skill_inventory inventory
             JOIN skill_definitions definition ON definition.id=inventory.skill_id
            WHERE inventory.player_pet_id=? AND inventory.quantity>0 AND definition.active=TRUE
            ORDER BY definition.display_name ASC,definition.id ASC`,
          [pet.player_pet_id],
        );
        equipped = equippedRows.map((row) => ({ code: row.code, displayName: row.display_name, grade: row.grade ?? "일반", level: BigInt(row.level), quantity: 0n, slotNo: row.slot_no }));
        inventory = inventoryRows.map((row) => ({ code: row.code, displayName: row.display_name, grade: row.grade ?? "일반", level: 0n, quantity: BigInt(row.quantity), slotNo: null }));
        const formatted = formatPetSkillStatus({ ownerName: pet.owner_name, petName: pet.pet_name, intimacyLevel: BigInt(pet.intimacy_level), equipped, inventory });
        reply = formatted.reply;
        slotLimit = formatted.slotLimit;
      }

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key],
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data: reply })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'player_pet',?,'pet.skill_read','success','Iris /펫스킬',?,UTC_TIMESTAMP(3))",
        [operation.insertId, pet?.player_pet_id ?? null, JSON.stringify({ externalUserId: input.externalUserId, equippedCount: equipped.length, inventoryCount: inventory.length, slotLimit, domainMutation: false })],
      );
      const result: PetSkillReadResult = {
        reply, outboxId: outbox.insertId.toString(), playerPetId: pet?.player_pet_id?.toString() ?? null,
        equippedCount: equipped.length, inventoryCount: inventory.length, slotLimit,
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
