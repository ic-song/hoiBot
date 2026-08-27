import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetSkillCompatibilityGroup {
  code: string;
  skills: string[];
}

export interface PetSkillDuplicateReadResult {
  reply: string;
  outboxId: string;
  groupCount: number;
  memberCount: number;
}

// 레거시와 동일하게 인자가 없는 정확한 펫스킬중복 명령만 허용합니다.
export function isPetSkillDuplicateReadCommand(message: string | undefined): boolean {
  return message === "/펫스킬중복";
}

// DB 호환 그룹을 레거시 중복 장착 불가 목록 형식으로 표시합니다.
export function formatPetSkillCompatibilityGroups(groups: readonly PetSkillCompatibilityGroup[]): string {
  const header = "📙 중복 장착 불가 목록 📙";
  if (groups.length === 0) return `${header}\n\n등록된 중복 장착 제한이 없습니다.`;
  return `${header}\n\n${groups.map((group) => `- ${group.skills.map((name) => name.endsWith("📙") ? name : `${name}📙`).join(" ↔ ")}`).join("\n")}`;
}

// 정규화된 펫스킬 호환 그룹을 읽고 실행·감사·outbox만 원자 기록합니다.
export class PetSkillDuplicateReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PetSkillDuplicateReadResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await transaction.query<Array<{ result_json: string | PetSkillDuplicateReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_duplicate_read' AND idempotency_key=? FOR UPDATE", [key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as PetSkillDuplicateReadResult : prior[0].result_json;
      }

      const rows = await transaction.query<Array<{ group_code: string; display_name: string }>>(
        `SELECT compatibility_group.code group_code,definition.display_name
         FROM pet_skill_compatibility_groups compatibility_group
         JOIN pet_skill_compatibility_members member ON member.group_id=compatibility_group.id
         JOIN skill_definitions definition ON definition.id=member.skill_id
         WHERE compatibility_group.active=TRUE AND definition.active=TRUE
         ORDER BY compatibility_group.display_order,member.display_order,definition.id`,
      );
      const groups: PetSkillCompatibilityGroup[] = [];
      for (const row of rows) {
        let group = groups[groups.length - 1];
        if (group?.code !== row.group_code) {
          group = { code: row.group_code, skills: [] };
          groups.push(group);
        }
        group.skills.push(row.display_name);
      }
      const reply = formatPetSkillCompatibilityGroups(groups);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill_duplicate_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key],
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ data: reply })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_DUPLICATE_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'pet_skill_compatibility',NULL,'pet.skill_duplicate_read','success','Iris /펫스킬중복',?,UTC_TIMESTAMP(3))",
        [operation.insertId, JSON.stringify({ externalUserId: input.externalUserId, groupCount: groups.length, memberCount: rows.length, domainMutation: false })],
      );
      const result: PetSkillDuplicateReadResult = { reply, outboxId: outbox.insertId.toString(), groupCount: groups.length, memberCount: rows.length };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
