import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "./application-error.js";

export interface OperationActor {
  type: "admin_operator" | "player" | "system";
  id?: string;
}

export interface OperationRequest {
  scope: string;
  idempotencyKey: string;
  actor: OperationActor;
  sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system";
  actionCode: string;
  targetType: string;
  targetId?: string;
  reason: string;
  outboxType?: string;
}

export interface OperationWorkResult<T> {
  result: T;
  changeSummary: Record<string, unknown>;
}

// 모든 도메인 변경을 idempotency·감사·outbox와 같은 DB 트랜잭션으로 실행합니다.
export class TransactionalOperationRunner {
  constructor(private readonly database: DatabaseClient) {}

  async run<T extends Record<string, unknown>>(request: OperationRequest, work: (transaction: DatabaseTransaction, operationId: bigint) => Promise<OperationWorkResult<T>>): Promise<T & { auditId: string }> {
    if (request.idempotencyKey.trim() === "" || request.idempotencyKey.length > 191) throw new ApplicationError("INVALID_IDEMPOTENCY_KEY", "Idempotency key는 1~191자여야 합니다.", 422);
    if (request.reason.trim() === "" || request.reason.length > 500) throw new ApplicationError("INVALID_OPERATION_REASON", "변경 사유는 1~500자여야 합니다.", 422);
    const scope = normalizeScope(request.scope);
    try {
      return await this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | T }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, request.idempotencyKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return (typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json) as T & { auditId: string };
      }
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, request.idempotencyKey, request.actor.type, request.actor.id ?? null, request.sourceCode]
      );
      const completed = await work(transaction, operation.insertId);
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'success', ?, ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, request.actor.type, request.actor.id ?? null, request.targetType, request.targetId ?? null,
          request.actionCode, request.reason, JSON.stringify(completed.changeSummary)]
      );
      const result = { ...completed.result, auditId: audit.insertId.toString() } as T & { auditId: string };
      await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'internal', ?, ?, ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, request.targetId ?? "system", request.outboxType ?? request.actionCode, JSON.stringify(result)]
      );
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | T | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?",
        [scope, request.idempotencyKey]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return (typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json) as T & { auditId: string };
    }
  }
}

// 스키마 길이를 넘는 scope는 원문 접두사와 SHA-256으로 충돌 없이 축약합니다.
function normalizeScope(scope: string): string {
  if (scope.length <= 128) return scope;
  const prefix = scope.slice(0, 55).replace(/[^a-zA-Z0-9:._-]/g, "_");
  return `${prefix}:sha256:${createHash("sha256").update(scope).digest("hex")}`;
}

// 동시 idempotency insert 경합만 기존 완료 결과 조회로 전환합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}
