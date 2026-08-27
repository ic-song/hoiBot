import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type PassSubscriptionRetiredCommand = {
  alias: "/공헌패스구독" | "/다이아패스구독";
  data: string;
};
export type PassSubscriptionRetiredResult = {
  status: "replied";
  data: string;
  outboxId: string;
  auditId: string;
  replayed: boolean;
};

const RESPONSE = "⚠️ 기존 패스 지급 명령어는 사용이 중단되었습니다.\n패스 지급 명령어가 /구독패스지급 으로 통합되었습니다.";
const CODE = "PASS_SUBSCRIPTION_RETIRED";
const HANDLER = "pass_subscription_retired";

// 레거시 통합 중단 안내에 실제 도달하는 두 패스 구독 명령 경계를 판별합니다.
export function isPassSubscriptionRetiredCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/(?:공헌패스구독|다이아패스구독)(?:\s+.*)?$/.test(message);
}

// 두 구독 명령을 고정 통합 안내로 변환합니다.
export function parsePassSubscriptionRetiredCommand(message: string): PassSubscriptionRetiredCommand | null {
  if (!isPassSubscriptionRetiredCommandCandidate(message)) return null;
  return { alias: message.startsWith("/공헌패스구독") ? "/공헌패스구독" : "/다이아패스구독", data: RESPONSE };
}

// suffix 안내 요청도 exact DB alias로 정규화합니다.
export function normalizePassSubscriptionRetiredDispatchMessage(message: string): string {
  return parsePassSubscriptionRetiredCommand(message)?.alias ?? message;
}

const eventKey = (value: string) => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | PassSubscriptionRetiredResult) => typeof value === "string" ? JSON.parse(value) as PassSubscriptionRetiredResult : value;

// retired 패스 안내만 실행·감사·Outbox 원장에 원자 기록합니다.
export class PassSubscriptionRetiredCommandService {
  public constructor(private readonly database: DatabaseClient) {}

  public async reply(input: { command: PassSubscriptionRetiredCommand; eventId: string; destinationId: string; actorId: string }): Promise<PassSubscriptionRetiredResult> {
    return this.database.withTransaction(async transaction => {
      const key = eventKey(input.eventId);
      const identity = (await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1", [input.actorId],
      ))[0];
      if (!identity) throw new ApplicationError("PASS_SUBSCRIPTION_RETIRED_IDENTITY_NOT_FOUND", "사용자 식별 정보를 확인할 수 없습니다.", 422);
      const prior = await transaction.query<Array<{ result_json: string | PassSubscriptionRetiredResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [HANDLER, key],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return { ...stored(prior[0].result_json), replayed: true };
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), HANDLER, key, identity.id],
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data: input.command.data })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, CODE, operation.insertId],
      );
      const audit = await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'retired_pass_command',NULL,'pass.subscription.retired','reply_queued','Iris 패스 구독 통합 안내',?,UTC_TIMESTAMP(3))",
        [operation.insertId, identity.id, JSON.stringify({ alias: input.command.alias, domainMutation: false })],
      );
      const result: PassSubscriptionRetiredResult = { status: "replied", data: input.command.data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), replayed: false };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
