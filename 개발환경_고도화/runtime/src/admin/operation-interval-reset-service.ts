import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface OperationIntervalResetResult {
  data: string;
  outboxId: string;
  cancellationGeneration: string;
  stoppedIntervalCount: number;
  previousIntervalMarker: string;
  version: string;
}

// 운영 주기 리셋은 인자와 접미 문구가 없는 정확 일치 명령만 허용합니다.
export function isOperationIntervalResetCommand(message: string | undefined): boolean {
  return message === "/주기리셋";
}

// 레거시 성공 응답을 그대로 반환합니다.
export function formatOperationIntervalResetReply(): string {
  return "주기리셋완";
}

// 취소 세대를 올리고 활성 주기와 이전 실행 기준을 한 트랜잭션에서 초기화합니다.
export class OperationIntervalResetService {
  constructor(private readonly database: DatabaseClient) {}

  async reset(input: { idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<OperationIntervalResetResult> {
    const scope = "admin.operation_interval.reset";
    return this.database.withTransaction(async (transaction) => {
      const lock = await transaction.query<Array<{ lock_code: string }>>(
        "SELECT lock_code FROM admin_global_locks WHERE lock_code='operation_interval_reset' FOR UPDATE"
      );
      if (lock[0] === undefined) throw new ApplicationError("OPERATION_INTERVAL_RESET_LOCK_MISSING", "운영 주기 리셋 잠금 설정이 없습니다.", 409);
      const prior = await transaction.query<Array<{ result_json: string | OperationIntervalResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }
      const controls = await transaction.query<Array<{
        cancellation_generation: bigint; active_interval_count: number; previous_interval_marker: bigint; version: bigint;
      }>>(
        "SELECT cancellation_generation,active_interval_count,previous_interval_marker,version FROM operation_interval_control WHERE control_code='legacy_exploration' FOR UPDATE"
      );
      const before = controls[0];
      if (before === undefined) throw new ApplicationError("OPERATION_INTERVAL_CONTROL_MISSING", "운영 주기 제어 설정이 없습니다.", 409);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const generation = before.cancellation_generation + 1n;
      const version = before.version + 1n;
      const update = await transaction.execute(
        `UPDATE operation_interval_control
         SET cancellation_generation=?,active_interval_count=0,previous_interval_marker=0,version=?,updated_by_operator_id=?,updated_at=UTC_TIMESTAMP(3)
         WHERE control_code='legacy_exploration' AND version=?`,
        [generation, version, input.operatorId, before.version]
      );
      if (update.affectedRows !== 1n) throw new ApplicationError("OPERATION_INTERVAL_VERSION_CONFLICT", "운영 주기 상태가 먼저 변경되었습니다.", 409);
      const data = formatOperationIntervalResetReply();
      const beforeJson = {
        cancellationGeneration: before.cancellation_generation.toString(),
        activeIntervalCount: Number(before.active_interval_count),
        previousIntervalMarker: before.previous_interval_marker.toString(),
        version: before.version.toString()
      };
      const afterJson = { cancellationGeneration: generation.toString(), activeIntervalCount: 0, previousIntervalMarker: "0", version: version.toString() };
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'operation_interval_control',NULL,'admin.operation_interval.reset','success','Iris 운영자 /주기리셋',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({ before: beforeJson, after: afterJson })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_OPERATION_INTERVAL_RESET',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: OperationIntervalResetResult = {
        data, outboxId: outbox.insertId.toString(), cancellationGeneration: generation.toString(),
        stoppedIntervalCount: Number(before.active_interval_count), previousIntervalMarker: before.previous_interval_marker.toString(), version: version.toString()
      };
      await transaction.execute(
        "INSERT INTO operation_interval_reset_mutations(operation_id,before_json,after_json) VALUES (?,?,?)",
        [operation.insertId, JSON.stringify(beforeJson), JSON.stringify({ ...afterJson, outboxId: result.outboxId })]
      );
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
