import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type RequestMonitorExceptionCommand = {
  kind: "command" | "room";
  action: "add" | "delete";
  value: string;
};

export interface RequestMonitorExceptionResult {
  data: string;
  outboxId: string;
  kind: "command" | "room";
  action: "add" | "delete";
  value: string;
  values: string[];
  version: string;
  changed: boolean;
}

const commandPattern = /^\/요청예외(명령|방)(추가|삭제)\s+(.*)$/;

// 요청 예외 명령은 네 접두어 뒤의 전체 문자열을 값으로 받는 형식만 허용합니다.
export function isRequestMonitorExceptionCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && commandPattern.test(message);
}

// legacy normalizeMonitorValue와 같이 접두어 뒤 전체 값을 trim합니다.
export function parseRequestMonitorExceptionCommand(message: string): RequestMonitorExceptionCommand {
  const match = commandPattern.exec(message);
  if (match === null) throw new ApplicationError("INVALID_REQUEST_MONITOR_EXCEPTION_COMMAND", "요청 예외 설정 명령 형식이 올바르지 않습니다.", 422);
  const kind = match[1] === "명령" ? "command" : "room";
  const action = match[2] === "추가" ? "add" : "delete";
  const value = match[3]!.trim();
  if (value.length === 0) throw new ApplicationError("EMPTY_REQUEST_MONITOR_EXCEPTION", usageFor(kind, action), 422);
  return { kind, action, value };
}

// 네 legacy 성공 응답을 대상 종류와 동작에 맞게 유지합니다.
export function formatRequestMonitorExceptionReply(command: RequestMonitorExceptionCommand): string {
  if (command.kind === "command") {
    return command.action === "add"
      ? `예외 명령어에 추가되었습니다: ${command.value}`
      : `예외 명령어에서 삭제되었습니다: ${command.value}`;
  }
  return command.action === "add"
    ? `예외 방에 추가되었습니다: ${command.value}`
    : `예외 방에서 삭제되었습니다: ${command.value}`;
}

// singleton config lock 아래 예외 배열·version·감사·outbox를 멱등 변경합니다.
export class RequestMonitorExceptionService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { command: RequestMonitorExceptionCommand; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<RequestMonitorExceptionResult> {
    const scope = `admin.request_monitor_exception.${input.command.kind}.${input.command.action}`;
    return this.database.withTransaction(async (transaction) => {
      const configs = await transaction.query<Array<{
        excluded_commands_json: string;
        excluded_rooms_json: string;
        version: bigint;
      }>>(
        "SELECT excluded_commands_json,excluded_rooms_json,version FROM request_monitor_config WHERE id=1 FOR UPDATE"
      );
      const config = configs[0];
      if (config === undefined) throw new ApplicationError("REQUEST_MONITOR_CONFIG_MISSING", "요청 감지 설정이 없습니다.", 409);

      const prior = await transaction.query<Array<{ result_json: string | RequestMonitorExceptionResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const current = parseStoredValues(input.command.kind === "command" ? config.excluded_commands_json : config.excluded_rooms_json);
      const values = input.command.action === "add"
        ? (current.includes(input.command.value) ? current.slice() : current.concat(input.command.value))
        : current.filter((value) => value !== input.command.value);
      const changed = values.length !== current.length;
      let version = config.version.toString();

      if (changed) {
        const column = input.command.kind === "command" ? "excluded_commands_json" : "excluded_rooms_json";
        const update = await transaction.execute(
          `UPDATE request_monitor_config SET ${column}=?,version=version+1,updated_by_operator_id=?,updated_at=UTC_TIMESTAMP(3)
           WHERE id=1 AND version=?`, [JSON.stringify(values), input.operatorId, config.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("REQUEST_MONITOR_CONFIG_VERSION_CONFLICT", "요청 설정이 먼저 변경되었습니다.", 409);
        version = (config.version + 1n).toString();
      }

      const data = formatRequestMonitorExceptionReply(input.command);
      const before = { kind: input.command.kind, values: current, version: config.version.toString() };
      const after = { kind: input.command.kind, values, version };
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'request_monitor_config',1,?,'success',?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, scope, `Iris 관리자 요청 예외 ${input.command.action}`,
          JSON.stringify({ value: input.command.value, changed, before, after })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: RequestMonitorExceptionResult = {
        data, outboxId: outbox.insertId.toString(), kind: input.command.kind, action: input.command.action,
        value: input.command.value, values, version, changed
      };
      if (changed) {
        await transaction.execute(
          "INSERT INTO request_monitor_config_mutations(operation_id,config_id,before_json,after_json) VALUES (?,1,?,?)",
          [operation.insertId, JSON.stringify(before), JSON.stringify({ ...after, auditId: audit.insertId.toString() })]
        );
      }
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}

function parseStoredValues(value: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApplicationError("INVALID_REQUEST_MONITOR_EXCEPTION_DATA", "요청 예외 설정 데이터가 올바르지 않습니다.", 409); }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new ApplicationError("INVALID_REQUEST_MONITOR_EXCEPTION_DATA", "요청 예외 설정 데이터가 올바르지 않습니다.", 409);
  }
  return parsed as string[];
}

function usageFor(kind: "command" | "room", action: "add" | "delete"): string {
  const kindText = kind === "command" ? "명령" : "방";
  const actionText = action === "add" ? "추가" : "삭제";
  const valueText = kind === "command" ? "명령어" : "방이름";
  return `사용법: /요청예외${kindText}${actionText} [${valueText}]`;
}
