import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetDataCompareInput {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  operatorId: string;
}

export interface PetDataCompareResult {
  status: "compared";
  memberCount: number;
  petCount: number;
  replies: Array<{ data: string; outboxId: string }>;
  auditId: string;
}

// `/펫데이터비교`는 인자나 접미 문구가 없는 정확 명령만 후보로 허용합니다.
export function isPetDataCompareCommand(message: string | undefined): boolean {
  return message === "/펫데이터비교";
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetDataCompareResult): PetDataCompareResult {
  return typeof value === "string" ? JSON.parse(value) as PetDataCompareResult : value;
}

// 회원과 펫의 안정 PK 개수를 같은 snapshot에서 읽고 기존 두 줄 응답을 각각 큐잉합니다.
export class PetDataCompareService {
  constructor(private readonly database: DatabaseClient) {}

  async compare(input: PetDataCompareInput): Promise<PetDataCompareResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.pet_data.compare:${input.operatorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetDataCompareResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const counts = await transaction.query<Array<{ member_count: bigint; pet_count: bigint }>>(
        "SELECT (SELECT COUNT(*) FROM player_profiles) AS member_count,(SELECT COUNT(*) FROM player_pets) AS pet_count",
      );
      const memberCount = Number(counts[0]?.member_count ?? 0n);
      const petCount = Number(counts[0]?.pet_count ?? 0n);
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );
      const replies: Array<{ data: string; outboxId: string }> = [];
      for (const data of [
        `member.json 회원 수=> ${memberCount}`,
        `member_pet.json 회원 수 => ${petCount}`,
      ]) {
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
           VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [operation.insertId, input.destinationId, JSON.stringify({ data })],
        );
        replies.push({ data, outboxId: outbox.insertId.toString() });
      }
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'admin_pet_data_compare',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'pet_data',NULL,'pet_data.compare','success','Iris /펫데이터비교',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({ memberCount, petCount })],
      );
      const result: PetDataCompareResult = {
        status: "compared", memberCount, petCount, replies, auditId: audit.insertId.toString(),
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
