import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetStatusInput {
  externalUserId: string;
  destinationId: string;
  idempotencyKey: string;
  sourceEventId: string;
}

export interface PetStatusResult {
  status: "displayed" | "no_reply";
  petId: string | null;
  data: string | null;
  outboxId: string | null;
  auditId: string | null;
}

interface PetStatusRow {
  identity_id: bigint;
  pet_id: bigint | null;
  pet_name: string | null;
  pet_image: string | null;
}

// `/펫상태`는 인자나 접미 문구가 없는 정확 명령만 후보로 허용합니다.
export function isPetStatusCommand(message: string | undefined): boolean {
  return message === "/펫상태";
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetStatusResult): PetStatusResult {
  return typeof value === "string" ? JSON.parse(value) as PetStatusResult : value;
}

// 현재 펫 이름과 import 단계에서 newimg 우선 적용된 표시 이미지를 조회합니다.
export class PetStatusService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: PetStatusInput): Promise<PetStatusResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `pet.status.read:${input.externalUserId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetStatusResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const rows = await transaction.query<PetStatusRow[]>(
        `SELECT identity.id AS identity_id,pet.id AS pet_id,pet.display_name AS pet_name,pet.image_value AS pet_image
         FROM external_identities identity
         LEFT JOIN player_pets pet ON pet.player_id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1 FOR UPDATE`,
        [input.externalUserId],
      );
      const row = rows[0];
      if (row === undefined) return { status: "no_reply", petId: null, data: null, outboxId: null, auditId: null };

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, row.identity_id],
      );
      const canReply = row.pet_id !== null && row.pet_name !== null && row.pet_name !== ""
        && row.pet_image !== null && row.pet_image !== "";
      const data = canReply ? row.pet_image : null;
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
         VALUES (?,'pet_status_read',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId, resultCode],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'player_pet',?,'pet.status.read',?,'Iris /펫상태',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, row.identity_id, row.pet_id, resultCode, JSON.stringify({ petName: row.pet_name, image: data })],
      );
      const result: PetStatusResult = {
        status: data === null ? "no_reply" : "displayed",
        petId: row.pet_id?.toString() ?? null,
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
