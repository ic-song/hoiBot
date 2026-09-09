import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";

const SENSITIVE_KEY = /(password|passwd|token|secret|credential|authorization|cookie|session)/i;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 500;
const MAX_STRING_LENGTH = 4_000;

export interface StatusAllSnapshot {
  data: string;
  entryCount: number;
  redactedCount: number;
  truncated: boolean;
  snapshotVersion: number;
}

export interface StatusAllResult extends StatusAllSnapshot {
  outboxId: string;
}

// 인자가 없는 정확한 전체 상태 명령만 현대화 dispatch 후보로 허용합니다.
export function isStatusAllCommand(message: string | undefined): boolean {
  return message === "/상태전체";
}

// 프로세스 재시작 시 비워지는 명령 상태를 일관된 한 시점의 안전한 projection으로 제공합니다.
export class TransientCommandStateStore {
  private readonly states: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  private version = 0;

  set(identityKey: string, state: unknown): void {
    this.states[identityKey] = state;
    this.version += 1;
  }

  delete(identityKey: string): void {
    if (Object.prototype.hasOwnProperty.call(this.states, identityKey)) {
      delete this.states[identityKey];
      this.version += 1;
    }
  }

  clear(): void {
    for (const key of Object.keys(this.states)) delete this.states[key];
    this.version += 1;
  }

  snapshot(): StatusAllSnapshot {
    const context = { entries: 0, redacted: 0, truncated: false, seen: new WeakSet<object>() };
    const projected = sanitizeValue(this.states, "", 0, context);
    return {
      data: JSON.stringify(projected, null, 2),
      entryCount: Object.keys(this.states).length,
      redactedCount: context.redacted,
      truncated: context.truncated,
      snapshotVersion: this.version
    };
  }
}

export const sharedTransientCommandStateStore = new TransientCommandStateStore();

// 관리자 권한 확인 후 상태 원문은 저장하지 않고 접근 감사와 응답 outbox만 원자 기록합니다.
export class StatusAllService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly stateStore: TransientCommandStateStore = sharedTransientCommandStateStore
  ) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }
    ).resolve({
      eventId: input.eventId,
      message: input.message,
      userId: input.externalUserId,
      hasTrustedDisplayName: true
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.read({
      eventId: input.eventId,
      externalUserId: input.externalUserId,
      destinationId: input.channelId
    });
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<StatusAllResult | null> {
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=?
          AND identity.status='linked' AND operator.status='active'
          AND NOT EXISTS (
            SELECT 1 FROM admin_operator_permission_overrides denied
             WHERE denied.operator_id=operator.id AND denied.permission_code='transient_state.read' AND denied.effect='deny'
          )
          AND (
            EXISTS (
              SELECT 1 FROM admin_operator_permission_overrides allowed
               WHERE allowed.operator_id=operator.id AND allowed.permission_code='transient_state.read' AND allowed.effect='allow'
            )
            OR EXISTS (
              SELECT 1 FROM admin_operator_roles operator_role
              JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
              JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='transient_state.read'
               WHERE operator_role.operator_id=operator.id
            )
          )
        LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;

    const idempotencyKey = input.eventId.length <= 191
      ? input.eventId
      : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    const snapshot = this.stateStore.snapshot();
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ result_json: string | StatusAllResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='transient_state.read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (previous?.result_json != null) {
        return typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
      }

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'transient_state.read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey, operator.id]
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data: snapshot.data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_STATUS_ALL',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'runtime_transient_state',NULL,'transient_state.read','success','Iris /상태전체',?,UTC_TIMESTAMP(3))",
        [operation.insertId, operator.id, JSON.stringify({
          readOnly: true,
          entryCount: snapshot.entryCount,
          redactedCount: snapshot.redactedCount,
          truncated: snapshot.truncated,
          snapshotVersion: snapshot.snapshotVersion
        })]
      );
      const result: StatusAllResult = { ...snapshot, outboxId: outbox.insertId.toString() };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    }));
  }
}

function sanitizeValue(
  value: unknown,
  key: string,
  depth: number,
  context: { entries: number; redacted: number; truncated: boolean; seen: WeakSet<object> }
): unknown {
  if (SENSITIVE_KEY.test(key)) {
    context.redacted += 1;
    return "[REDACTED]";
  }
  if (depth > MAX_DEPTH) {
    context.truncated = true;
    return "[TRUNCATED:DEPTH]";
  }
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    context.truncated = true;
    return `${value.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`;
  }
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (typeof value !== "object") return String(value);
  if (context.seen.has(value)) return "[Circular]";
  context.seen.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (context.entries >= MAX_ENTRIES) { context.truncated = true; result.push("[TRUNCATED:ENTRIES]"); break; }
      context.entries += 1;
      result.push(sanitizeValue(value[index], String(index), depth + 1, context));
    }
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const childKey of Object.keys(value as Record<string, unknown>)) {
    if (context.entries >= MAX_ENTRIES) { context.truncated = true; result.__truncated__ = "[TRUNCATED:ENTRIES]"; break; }
    context.entries += 1;
    result[childKey] = sanitizeValue((value as Record<string, unknown>)[childKey], childKey, depth + 1, context);
  }
  return result;
}

// 교차 event gap lock에서 발생하는 MariaDB deadlock만 제한적으로 재시도합니다.
async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await work(); }
    catch (error) {
      const databaseError = error as { code?: unknown; errno?: unknown };
      if (attempt === 2 || (databaseError.code !== "ER_LOCK_DEADLOCK" && databaseError.errno !== 1213)) throw error;
    }
  }
  throw new Error("Transient state read deadlock retry exhausted.");
}
