import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type RequestMonitorConfigCommand = { kind: "read" } | { kind: "update"; windowMs: number; limitCount: number };
export interface RequestMonitorConfigResult { data: string; outboxId: string; windowMs: string; limitCount: string; version: string; changed: boolean; }

// 요청 설정은 exact 조회 또는 인자 두 개의 전체 형식만 후보로 허용합니다.
export function isRequestMonitorConfigCommandCandidate(message: string | undefined): boolean {
  return message === "/요청설정" || (message !== undefined && /^\/요청설정\s+\S+\s+\S+$/.test(message));
}

// legacy Number 양수 검사와 Math.floor 단위를 DB-safe 정수로 변환합니다.
export function parseRequestMonitorConfigCommand(message: string): RequestMonitorConfigCommand {
  if (message === "/요청설정") return { kind: "read" };
  const match = /^\/요청설정\s+(\S+)\s+(\S+)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_REQUEST_MONITOR_CONFIG", "사용법: /요청설정 [초] [횟수]", 422);
  const seconds = Number(match[1]);
  const limit = Number(match[2]);
  if (!Number.isFinite(seconds) || !Number.isFinite(limit) || seconds <= 0 || limit <= 0) {
    throw new ApplicationError("INVALID_REQUEST_MONITOR_CONFIG_VALUE", "초와 횟수는 0보다 큰 숫자여야 합니다.", 422);
  }
  const windowMs = Math.floor(seconds * 1000);
  const limitCount = Math.floor(limit);
  if (!Number.isSafeInteger(windowMs) || !Number.isSafeInteger(limitCount) || windowMs <= 0) {
    throw new ApplicationError("REQUEST_MONITOR_CONFIG_OUT_OF_RANGE", "요청 설정 숫자가 허용 범위를 벗어났습니다.", 422);
  }
  return { kind: "update", windowMs, limitCount };
}

// 요청 설정 조회·변경 응답을 동일한 초·횟수 단위로 생성합니다.
export function formatRequestMonitorConfigReply(windowMs: string, limitCount: string, changed: boolean): string {
  const seconds = formatMillisecondsAsSeconds(windowMs);
  const title = changed ? "✅ 요청 감지 설정 변경 완료" : "📋 요청 감지 설정";
  return `${title}\n\n감지 시간: ${seconds}초\n감지 횟수: ${BigInt(limitCount).toString()}회`;
}

// singleton config lock 아래 조회·version 변경·감사·outbox를 멱등 처리합니다.
export class RequestMonitorConfigService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { command: RequestMonitorConfigCommand; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<RequestMonitorConfigResult> {
    const scope = input.command.kind === "read" ? "admin.request_monitor_config.read" : "admin.request_monitor_config.update";
    return this.database.withTransaction(async (transaction) => {
      const configs = await transaction.query<Array<{ window_ms: string; limit_count: string; version: bigint }>>(
        "SELECT CAST(window_ms AS CHAR) AS window_ms,CAST(limit_count AS CHAR) AS limit_count,version FROM request_monitor_config WHERE id=1 FOR UPDATE"
      );
      const config = configs[0];
      if (config === undefined) throw new ApplicationError("REQUEST_MONITOR_CONFIG_MISSING", "요청 감지 설정이 없습니다.", 409);
      const prior = await transaction.query<Array<{ result_json: string | RequestMonitorConfigResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`, [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const before = { windowMs: config.window_ms, limitCount: config.limit_count, version: config.version.toString() };
      let windowMs = config.window_ms;
      let limitCount = config.limit_count;
      let version = config.version.toString();
      if (input.command.kind === "update") {
        const update = await transaction.execute(
          `UPDATE request_monitor_config SET window_ms=?,limit_count=?,version=version+1,updated_by_operator_id=?,updated_at=UTC_TIMESTAMP(3)
           WHERE id=1 AND version=?`, [input.command.windowMs, input.command.limitCount, input.operatorId, config.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("REQUEST_MONITOR_CONFIG_VERSION_CONFLICT", "요청 설정이 먼저 변경되었습니다.", 409);
        windowMs = input.command.windowMs.toString();
        limitCount = input.command.limitCount.toString();
        version = (config.version + 1n).toString();
      }
      const changed = input.command.kind === "update";
      const data = formatRequestMonitorConfigReply(windowMs, limitCount, changed);
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'request_monitor_config',1,?,'success',?, ?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, changed ? "admin.request_monitor_config.update" : "admin.request_monitor_config.read",
          changed ? "Iris 관리자 /요청설정 변경" : "Iris 관리자 /요청설정 조회", JSON.stringify({ before, after: { windowMs, limitCount, version } })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_REQUEST_MONITOR_CONFIG',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: RequestMonitorConfigResult = { data, outboxId: outbox.insertId.toString(), windowMs, limitCount, version, changed };
      if (changed) {
        await transaction.execute(
          "INSERT INTO request_monitor_config_mutations(operation_id,config_id,before_json,after_json) VALUES (?,1,?,?)",
          [operation.insertId, JSON.stringify(before), JSON.stringify({ windowMs, limitCount, version, auditId: audit.insertId.toString() })]
        );
      }
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

function formatMillisecondsAsSeconds(windowMs: string): string {
  const value = BigInt(windowMs);
  const whole = value / 1000n;
  const remainder = value % 1000n;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder.toString().padStart(3, "0").replace(/0+$/, "")}`;
}
