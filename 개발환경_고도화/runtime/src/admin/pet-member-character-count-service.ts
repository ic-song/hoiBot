import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetMemberCharacterCountInput {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  identityId: string;
}

export interface PetMemberCharacterCountResult {
  status: "counted" | "missing";
  characterCount: string | null;
  data: string | null;
  outboxId: string | null;
  auditId: string;
}

// `/펫멤버글자수`는 인자나 접미 문구가 없는 정확 명령만 후보로 허용합니다.
export function isPetMemberCharacterCountCommand(message: string | undefined): boolean {
  return message === "/펫멤버글자수";
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 저장된 bigint 글자 수를 기존 세 자리 쉼표 형식으로 표시합니다.
function formatCharacterCount(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetMemberCharacterCountResult): PetMemberCharacterCountResult {
  return typeof value === "string" ? JSON.parse(value) as PetMemberCharacterCountResult : value;
}

// member_pet 원문 snapshot의 Rhino UTF-16 글자 수를 읽고 응답 원장을 원자 기록합니다.
export class PetMemberCharacterCountService {
  constructor(private readonly database: DatabaseClient) {}

  async count(input: PetMemberCharacterCountInput): Promise<PetMemberCharacterCountResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.pet_member_character_count:${input.identityId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetMemberCharacterCountResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const snapshots = await transaction.query<Array<{ utf16_character_count: bigint }>>(
        "SELECT utf16_character_count FROM pet_member_storage_snapshots WHERE snapshot_code='member_pet' FOR UPDATE",
      );
      const snapshot = snapshots[0];
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.identityId],
      );
      const characterCount = snapshot?.utf16_character_count ?? null;
      const data = characterCount === null ? null : `총 글자 수 : ${formatCharacterCount(characterCount)}`;
      let outboxId: string | null = null;
      if (data !== null) {
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
           VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [operation.insertId, input.destinationId, JSON.stringify({ data })],
        );
        outboxId = outbox.insertId.toString();
      }
      const resultCode = data === null ? "no_reply" : "reply_queued";
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'admin_pet_member_character_count',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId, resultCode],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'pet_member_snapshot',NULL,'pet_member.character_count',?,'Iris /펫멤버글자수',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.identityId, resultCode, JSON.stringify({ characterCount: characterCount?.toString() ?? null })],
      );
      const result: PetMemberCharacterCountResult = {
        status: data === null ? "missing" : "counted",
        characterCount: characterCount?.toString() ?? null,
        data,
        outboxId,
        auditId: audit.insertId.toString(),
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
