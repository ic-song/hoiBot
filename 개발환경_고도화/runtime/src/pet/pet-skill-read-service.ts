import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const ALL_SEE = "\u200b".repeat(500);
const GRADE_ORDER = ["SS", "S", "A", "B", "C", "D"] as const;

export type PetSkillReadCommand =
  | { kind: "status" }
  | { kind: "probability" }
  | { kind: "info"; query: string | null };

export interface PetSkillViewRow {
  code: string; displayName: string; grade: string; level: bigint; quantity: bigint; slotNo: number | null;
}

export interface PetSkillCatalogRow {
  code: string; displayName: string; grade: string; rate: number; effect: string; tierInfo: string;
}

export interface PetSkillReadResult {
  reply: string; outboxId: string; playerPetId: string | null; equippedCount: number;
  inventoryCount: number; slotLimit: number; commandKind: PetSkillReadCommand["kind"];
}

// 세 조회 명령을 exact 또는 공백으로 구분된 자유 입력 형태로만 분류합니다.
export function parsePetSkillReadCommand(message: string | undefined): PetSkillReadCommand | undefined {
  if (message === "/펫스킬") return { kind: "status" };
  if (message === "/펫스킬확률") return { kind: "probability" };
  if (message === "/펫스킬정보") return { kind: "info", query: null };
  const match = message?.match(/^\/펫스킬정보\s+(.+)$/);
  return match == null ? undefined : { kind: "info", query: match[1]!.trim() };
}

// 공용 dispatch가 세 조회 명령 후보만 받도록 제한합니다.
export function isPetSkillReadCommand(message: string | undefined): boolean {
  return parsePetSkillReadCommand(message) !== undefined;
}

// 친밀도 100레벨당 1칸, 최대 30칸과 학개론 장착 보너스 3칸을 계산합니다.
export function calculatePetSkillSlotLimit(intimacyLevel: bigint, hasTextbook: boolean): number {
  const base = intimacyLevel / 100n > 30n ? 30 : Number(intimacyLevel / 100n);
  return base + (hasTextbook ? 3 : 0);
}

// 장착 순서와 가방 수량을 분리해 펫스킬 현황 메시지를 만듭니다.
export function formatPetSkillStatus(input: {
  ownerName: string; petName: string; intimacyLevel: bigint;
  equipped: readonly PetSkillViewRow[]; inventory: readonly PetSkillViewRow[];
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

// DB 카탈로그를 레거시 SS~D 순서와 소수 첫째 자리 확률로 표시합니다.
export function formatPetSkillProbability(rows: readonly PetSkillCatalogRow[]): string {
  let data = `📙 펫스킬북 확률표 📙\n\n${ALL_SEE}\n`;
  let total = 0;
  for (const grade of GRADE_ORDER) {
    data += `━━━${grade} 등급━━━\n`;
    for (const row of rows.filter((candidate) => candidate.grade === grade)) {
      total += row.rate;
      data += `${row.displayName} (확률: ${row.rate.toFixed(1)}%)\n`;
    }
    data += "\n";
  }
  return `${data}━━━━━━━━━━━━━━━\n총 확률: ${total.toFixed(1)}%`.trim();
}

// 스킬의 등급·실제 확률·효과·티어 부가설명을 한 번에 표시합니다.
export function formatPetSkillCatalogInfo(row: PetSkillCatalogRow): string {
  return `${row.displayName}\n등급: ${row.grade}\n확률: ${row.rate.toFixed(1)}%\n효과: ${row.effect}${row.tierInfo}`;
}

const normalizeLookup = (value: string): string => value.replace(/[\s✨📙]/g, "").toLocaleLowerCase("ko-KR");

// 정규화된 펫·스킬 projection을 읽고 실행·감사·outbox만 원자 기록합니다.
export class PetSkillReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetSkillReadResult> {
    const command = parsePetSkillReadCommand(input.message);
    if (command === undefined) throw new Error("Unsupported pet skill read command.");
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetSkillReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_read' AND idempotency_key=? FOR UPDATE", [key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as PetSkillReadResult : prior[0].result_json;
      }

      let reply: string;
      let playerPetId: string | null = null;
      let equippedCount = 0;
      let inventoryCount = 0;
      let slotLimit = 0;
      if (command.kind === "probability") {
        reply = formatPetSkillProbability(await this.readCatalog(transaction));
      } else if (command.kind === "info") {
        if (command.query === null) {
          reply = "사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)";
        } else {
          const target = (await transaction.query<Array<{ player_id: bigint }>>(
            "SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2", [command.query],
          ))[0];
          if (target !== undefined) {
            if (!(await this.isOperator(transaction, input.externalUserId))) {
              reply = "❌ 다른 유저의 펫스킬 조회는 관리자만 가능합니다.";
            } else {
              const projection = await this.readProjection(transaction, target.player_id);
              ({ reply, playerPetId, equippedCount, inventoryCount, slotLimit } = projection);
            }
          } else {
            const catalog = await this.readCatalog(transaction);
            const query = normalizeLookup(command.query);
            const found = catalog.find((row) => normalizeLookup(row.displayName) === query || normalizeLookup(row.code) === query);
            reply = found === undefined
              ? "등록되지 않은 펫스킬입니다.\n또는 존재하지 않는 유저입니다."
              : formatPetSkillCatalogInfo(found);
          }
        }
      } else {
        const identity = (await transaction.query<Array<{ player_id: bigint }>>(
          "SELECT player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1", [input.externalUserId],
        ))[0];
        const projection = identity === undefined ? this.emptyProjection() : await this.readProjection(transaction, identity.player_id);
        ({ reply, playerPetId, equippedCount, inventoryCount, slotLimit } = projection);
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
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'player_pet',?,'pet.skill_read','success',?,?,UTC_TIMESTAMP(3))",
        [operation.insertId, playerPetId, `Iris ${input.message}`, JSON.stringify({ externalUserId: input.externalUserId, commandKind: command.kind, equippedCount, inventoryCount, slotLimit, domainMutation: false })],
      );
      const result: PetSkillReadResult = { reply, outboxId: outbox.insertId.toString(), playerPetId, equippedCount, inventoryCount, slotLimit, commandKind: command.kind };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private emptyProjection(): { reply: string; playerPetId: null; equippedCount: 0; inventoryCount: 0; slotLimit: 0 } {
    return { reply: "등록된 펫이 없습니다.", playerPetId: null, equippedCount: 0, inventoryCount: 0, slotLimit: 0 };
  }

  private async readProjection(transaction: DatabaseTransaction, playerId: bigint) {
    const pet = (await transaction.query<Array<{ player_pet_id: bigint; owner_name: string; pet_name: string; intimacy_level: bigint }>>(
      `SELECT pet.id player_pet_id,profile.current_display_name owner_name,pet.display_name pet_name,COALESCE(intimacy.intimacy_level,0) intimacy_level
       FROM players player JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_pets pet ON pet.player_id=player.id
       LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id
       WHERE player.id=? AND player.status='active' AND player.deleted_at IS NULL ORDER BY pet.id LIMIT 1 FOR UPDATE`, [playerId],
    ))[0];
    if (pet?.player_pet_id == null) return this.emptyProjection();
    const equippedRows = await transaction.query<Array<{ code: string; display_name: string; grade: string | null; level: bigint; slot_no: number }>>(
      `SELECT definition.code,definition.display_name,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.grade')),'일반') grade,skill.level,skill.slot_no
       FROM pet_skills skill JOIN skill_definitions definition ON definition.id=skill.skill_id
       WHERE skill.player_pet_id=? AND skill.equipped=TRUE AND definition.active=TRUE ORDER BY skill.slot_no`, [pet.player_pet_id],
    );
    const inventoryRows = await transaction.query<Array<{ code: string; display_name: string; grade: string | null; quantity: bigint }>>(
      `SELECT definition.code,definition.display_name,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.grade')),'일반') grade,inventory.quantity
       FROM pet_skill_inventory inventory JOIN skill_definitions definition ON definition.id=inventory.skill_id
       WHERE inventory.player_pet_id=? AND inventory.quantity>0 AND definition.active=TRUE ORDER BY definition.display_name,definition.id`, [pet.player_pet_id],
    );
    const equipped: PetSkillViewRow[] = equippedRows.map((row) => ({ code: row.code, displayName: row.display_name, grade: row.grade ?? "일반", level: BigInt(row.level), quantity: 0n, slotNo: row.slot_no }));
    const inventory: PetSkillViewRow[] = inventoryRows.map((row) => ({ code: row.code, displayName: row.display_name, grade: row.grade ?? "일반", level: 0n, quantity: BigInt(row.quantity), slotNo: null }));
    const formatted = formatPetSkillStatus({ ownerName: pet.owner_name, petName: pet.pet_name, intimacyLevel: BigInt(pet.intimacy_level), equipped, inventory });
    return { reply: formatted.reply, playerPetId: pet.player_pet_id.toString(), equippedCount: equipped.length, inventoryCount: inventory.length, slotLimit: formatted.slotLimit };
  }

  private async readCatalog(transaction: DatabaseTransaction): Promise<PetSkillCatalogRow[]> {
    const rows = await transaction.query<Array<{ code: string; display_name: string; grade: string; rate_value: string; effect_value: string; tier_info: string }>>(
      `SELECT code,display_name,JSON_UNQUOTE(JSON_EXTRACT(rules_json,'$.grade')) grade,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(rules_json,'$.actualRate')),JSON_UNQUOTE(JSON_EXTRACT(rules_json,'$.rate')),'0') rate_value,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(rules_json,'$.effect')),'') effect_value,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(rules_json,'$.tierInfo')),'') tier_info
       FROM skill_definitions WHERE active=TRUE AND JSON_EXTRACT(rules_json,'$.grade') IS NOT NULL
       AND (JSON_EXTRACT(rules_json,'$.actualRate') IS NOT NULL OR JSON_EXTRACT(rules_json,'$.rate') IS NOT NULL)
       ORDER BY FIELD(JSON_UNQUOTE(JSON_EXTRACT(rules_json,'$.grade')),'SS','S','A','B','C','D'),id`,
    );
    return rows.map((row) => ({ code: row.code, displayName: row.display_name, grade: row.grade, rate: Number(row.rate_value), effect: row.effect_value, tierInfo: row.tier_info }));
  }

  private async isOperator(transaction: DatabaseTransaction, externalUserId: string): Promise<boolean> {
    const rows = await transaction.query<Array<{ allowed: number }>>(
      `SELECT 1 allowed FROM external_identities identity_row
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity_row.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('manager','super_admin') AND role.active=TRUE
       WHERE identity_row.provider_code='kakao' AND identity_row.external_user_id=? AND identity_row.status='linked' LIMIT 1`, [externalUserId],
    );
    return rows[0] !== undefined;
  }
}
