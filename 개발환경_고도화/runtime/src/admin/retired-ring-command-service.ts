import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface RetiredRingCommand {
  commandCode: string;
  handlerKey: string;
  data: string;
  requiresMaster: boolean;
}

export interface RetiredRingCommandInput {
  command: RetiredRingCommand;
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  actorId: string;
}

export interface RetiredRingCommandResult {
  status: "replied";
  data: string;
  outboxId: string;
  auditId: string;
}

const RING_MIGRATION_GUIDE = "기존 반지 강화 매력은 /반지보상받기로 보상받을 수 있습니다.";

// 레거시에서 종료 안내를 반환하는 네 반지 명령 후보를 원래 guard 그대로 판별합니다.
export function isRetiredRingCommandCandidate(message: string | undefined): boolean {
  return message === "/반지이름조합"
    || message === "/반지강화"
    || (message !== undefined && /^\/반지강화\s+\d+$/.test(message))
    || (message !== undefined && message.startsWith("/반지이름 "))
    || (message !== undefined && message.startsWith("/반지속성"));
}

// 반지 종료 명령을 안정 command code, 권한, 고정 레거시 응답으로 변환합니다.
export function parseRetiredRingCommand(message: string): RetiredRingCommand | null {
  if (message === "/반지이름조합") {
    return { commandCode: "RING_NAME_CRAFT_RETIRED", handlerKey: "ring_name_craft_retired", data: `반지 이름변경권 조합은 펜던트 콘텐츠 전환으로 종료되었습니다.\n${RING_MIGRATION_GUIDE}`, requiresMaster: false };
  }
  if (message === "/반지강화" || /^\/반지강화\s+\d+$/.test(message)) {
    return { commandCode: "RING_UPGRADE_RETIRED", handlerKey: "ring_upgrade_retired", data: `반지강화는 펜던트 콘텐츠 전환으로 종료되었습니다.\n${RING_MIGRATION_GUIDE}`, requiresMaster: false };
  }
  if (message.startsWith("/반지이름 ")) {
    return { commandCode: "RING_NAME_RETIRED", handlerKey: "ring_name_retired", data: `반지 이름변경은 펜던트 콘텐츠 전환으로 종료되었습니다.\n${RING_MIGRATION_GUIDE}`, requiresMaster: false };
  }
  if (message.startsWith("/반지속성")) {
    return { commandCode: "RING_ATTRIBUTE_RETIRED", handlerKey: "ring_attribute_retired", data: "반지속성 수정은 펜던트 콘텐츠 전환으로 종료되었습니다.", requiresMaster: true };
  }
  return null;
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | RetiredRingCommandResult): RetiredRingCommandResult {
  return typeof value === "string" ? JSON.parse(value) as RetiredRingCommandResult : value;
}

// 종료된 반지 명령의 고정 안내와 실행·감사·Outbox 원장을 원자 기록합니다.
export class RetiredRingCommandService {
  constructor(private readonly database: DatabaseClient) {}

  async reply(input: RetiredRingCommandInput): Promise<RetiredRingCommandResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `${input.command.handlerKey}:${input.actorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | RetiredRingCommandResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.actorId],
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data: input.command.data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, input.command.handlerKey, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'retired_ring_command',NULL,?,'reply_queued','Iris 종료 반지 명령 안내',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.actorId, `ring.retired.${input.command.handlerKey}`, JSON.stringify({ commandCode: input.command.commandCode })],
      );
      const result: RetiredRingCommandResult = { status: "replied", data: input.command.data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
