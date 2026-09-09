import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetTitleStoreResetInput {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  operatorId: string;
}

export interface PetTitleStoreResetResult {
  status: "reset";
  removedInstanceCount: number;
  removedAssignmentCount: number;
  data: string;
  outboxId: string;
  auditId: string;
}

// 레거시 파일 초기화는 인자 없는 정확 명령만 후보로 허용합니다.
export function isPetTitleStoreResetCommand(message: string | undefined): boolean {
  return message === "/펫타이틀파일생성";
}

// 긴 Iris event ID를 operations의 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetTitleStoreResetResult): PetTitleStoreResetResult {
  return typeof value === "string" ? JSON.parse(value) as PetTitleStoreResetResult : value;
}

// 레거시 petTitlePath 전체 덮어쓰기를 두 DB 저장소의 원자 초기화로 실행합니다.
export class PetTitleStoreResetService {
  constructor(private readonly database: DatabaseClient) {}

  async reset(input: PetTitleStoreResetInput): Promise<PetTitleStoreResetResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.pet_title_store.reset:${input.operatorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetTitleStoreResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const instances = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM player_pet_title_instances ORDER BY id FOR UPDATE",
      );
      const assignments = await transaction.query<Array<{ player_pet_id: bigint; title_id: bigint }>>(
        "SELECT player_pet_id,title_id FROM pet_titles ORDER BY player_pet_id,title_id FOR UPDATE",
      );
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );
      await transaction.execute("DELETE FROM player_pet_title_instances");
      await transaction.execute("DELETE FROM pet_titles");
      const data = "✅ 펫 타이틀 데이터 파일이 성공적으로 생성되었습니다.";
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'admin_pet_title_store_reset',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'pet_title_store',NULL,'pet_title_store.reset','success','Iris /펫타이틀파일생성',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({
          removedInstanceCount: instances.length,
          removedAssignmentCount: assignments.length,
        })],
      );
      const result: PetTitleStoreResetResult = {
        status: "reset", removedInstanceCount: instances.length, removedAssignmentCount: assignments.length,
        data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(),
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}

