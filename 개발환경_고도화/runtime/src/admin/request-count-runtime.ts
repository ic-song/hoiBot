import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";

export type RequestCountCommand = { target: string | null };
type RequestMonitorSnapshot = { windowMs: number; excludedCommands: string[]; excludedRooms: string[] };
type RequestCountResult = { data: string; outboxId: string; count: string; target: string; windowMs: string; replayed: boolean };

// 요청 횟수 명령은 exact 본인 조회 또는 공백 포함 사용자명 조회만 허용합니다.
export function parseRequestCountCommand(message: string | undefined): RequestCountCommand | null {
  if (message === "/요청횟수") return { target: null };
  const match = message === undefined ? null : /^\/요청횟수\s+(\S(?:[^\r\n]*\S)?)$/.exec(message);
  return match === null ? null : { target: match[1]!.trim() };
}

// partial dispatcher가 인자형 명령을 하나의 stable alias로 조회하도록 정규화합니다.
export function normalizeRequestCountDispatchMessage(message: string): string {
  return parseRequestCountCommand(message) === null ? message : "/요청횟수";
}

// 완전한 요청 횟수 명령만 modern dispatch 후보로 판정합니다.
export function isRequestCountCommandCandidate(message: string | undefined): boolean {
  return parseRequestCountCommand(message) !== null;
}

function parseStringArray(value: string, code: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApplicationError(code, "요청 감지 예외 설정이 올바르지 않습니다.", 409); }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) throw new ApplicationError(code, "요청 감지 예외 설정이 올바르지 않습니다.", 409);
  return parsed as string[];
}

async function readSnapshot(database: DatabaseClient): Promise<RequestMonitorSnapshot> {
  const row = (await database.query<Array<{ window_ms: bigint | string; excluded_commands_json: string; excluded_rooms_json: string }>>(
    "SELECT window_ms,excluded_commands_json,excluded_rooms_json FROM request_monitor_config WHERE id=1"
  ))[0];
  if (row === undefined) throw new ApplicationError("REQUEST_MONITOR_CONFIG_MISSING", "요청 감지 설정이 없습니다.", 409);
  const windowMs = Number(row.window_ms);
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new ApplicationError("REQUEST_MONITOR_WINDOW_INVALID", "요청 감지 시간이 올바르지 않습니다.", 409);
  return { windowMs, excludedCommands: parseStringArray(row.excluded_commands_json, "REQUEST_MONITOR_COMMAND_EXCLUSIONS_INVALID"), excludedRooms: parseStringArray(row.excluded_rooms_json, "REQUEST_MONITOR_ROOM_EXCLUSIONS_INVALID") };
}

function isExcludedCommand(message: string, configured: string[]): boolean {
  const values = ["/요청횟수", "/요청설정", ...configured];
  return values.some((value) => message === value || message.startsWith(`${value} `));
}

function formatWindowSeconds(windowMs: number): string {
  const seconds = windowMs / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(seconds).replace(/0+$/, "").replace(/\.$/, "");
}

// legacy userRequestTracker와 같은 process-local sliding window를 유지합니다.
export class RequestCountRuntime {
  private readonly histories = new Map<string, number[]>();
  private readonly seenEvents = new Map<string, number>();
  public constructor(private readonly now: () => number = Date.now) {}

  public async observe(database: DatabaseClient, event: NormalizedIrisEvent, roomName?: string): Promise<void> {
    if (event.direction !== "incoming" || event.displayName === undefined || event.message === undefined || isRequestCountCommandCandidate(event.message)) return;
    const snapshot = await readSnapshot(database);
    if (isExcludedCommand(event.message, snapshot.excludedCommands)) return;
    if (snapshot.excludedRooms.includes(roomName ?? "") || snapshot.excludedRooms.includes(event.channelId ?? "")) return;
    const now = this.now();
    if (this.seenEvents.has(event.eventId)) return;
    this.seenEvents.set(event.eventId, now);
    const cutoff = now - snapshot.windowMs;
    const history = (this.histories.get(event.displayName) ?? []).filter((timestamp) => timestamp >= cutoff);
    history.push(now);
    this.histories.set(event.displayName, history);
    for (const [eventId, timestamp] of this.seenEvents) if (timestamp < cutoff) this.seenEvents.delete(eventId);
  }

  public count(target: string, windowMs: number): number {
    const cutoff = this.now() - windowMs;
    const history = (this.histories.get(target) ?? []).filter((timestamp) => timestamp >= cutoff);
    if (history.length === 0) this.histories.delete(target); else this.histories.set(target, history);
    return history.length;
  }

  public reset(): void { this.histories.clear(); this.seenEvents.clear(); }
}

export const requestCountRuntime = new RequestCountRuntime();

// Iris 수신 메시지를 process-local 요청 창에 기록합니다.
export async function observeRequestCountEvent(database: DatabaseClient | undefined, event: NormalizedIrisEvent, roomName?: string): Promise<void> {
  if (database === undefined || process.env.REQUEST_COUNT_RUNTIME_COMMAND_ENABLED !== "true") return;
  await requestCountRuntime.observe(database, event, roomName);
}

// 관리자 요청 횟수 조회를 감사·outbox와 함께 멱등 처리합니다.
export class RequestCountIrisHandler {
  public constructor(private readonly database: DatabaseClient, private readonly runtime: RequestCountRuntime = requestCountRuntime) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; outboxId: string; replayed: boolean }> {
    const command = parseRequestCountCommand(event.message);
    if (command === null) throw new ApplicationError("REQUEST_COUNT_COMMAND_INVALID", "사용법: /요청횟수 [유저명]", 422);
    if (!event.userId || !event.channelId || !event.displayName) throw new ApplicationError("REQUEST_COUNT_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const operator = (await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code='admin.request_monitor.configure'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [event.userId]
    ))[0];
    if (operator === undefined) throw new ApplicationError("REQUEST_COUNT_FORBIDDEN", "요청 횟수 조회 권한이 없습니다.", 403);
    const snapshot = await readSnapshot(this.database);
    const target = command.target ?? event.displayName;
    const count = this.runtime.count(target, snapshot.windowMs);
    const data = `[${target}] 최근 ${formatWindowSeconds(snapshot.windowMs)}초 요청 횟수: ${count}회`;
    const result = await this.database.withTransaction(async (transaction) => {
      const prior = (await transaction.query<Array<{ result_json: string | RequestCountResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='admin.request_count.read' AND idempotency_key=? FOR UPDATE", [event.eventId]))[0];
      if (prior?.result_json != null) {
        const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as RequestCountResult : prior.result_json;
        return { ...stored, replayed: true };
      }
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'admin.request_count.read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), event.eventId, operator.operator_id]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'request_runtime_counter',NULL,'admin.request_count.read','success','Iris 관리자 요청 횟수 조회',?,UTC_TIMESTAMP(3))", [operation.insertId, operator.operator_id, JSON.stringify({ target, windowMs: snapshot.windowMs, count })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'REQUEST_COUNT_RUNTIME',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [event.eventId, operation.insertId]);
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, event.channelId, JSON.stringify({ data })]);
      const value: RequestCountResult = { data, outboxId: outbox.insertId.toString(), count: String(count), target, windowMs: String(snapshot.windowMs), replayed: false };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(value), operation.insertId]);
      return value;
    });
    return { message: result.data, room: event.channelId, outboxId: result.outboxId, replayed: result.replayed };
  }
}
