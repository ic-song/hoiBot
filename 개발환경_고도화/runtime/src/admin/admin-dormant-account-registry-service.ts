import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { resolveAccountDeleteOperator } from "./admin-account-delete-progress-service.js";

export type AdminDormantRegistryCommand =
  | { kind: "list" }
  | { kind: "usage"; action: "register" | "release" }
  | { kind: "register" | "release"; targetName: string };

export type AdminDormantRegistryResult = {
  message: string;
  outboxId: string;
  replayed: boolean;
  resultCode: string;
  targetPlayerId: string | null;
  changed: boolean;
};

type Target = { player_id: bigint; display_name: string };
type RegistryRow = { player_id: bigint; display_name: string; started_date: string; elapsed_days: bigint };
const SCOPE = "admin.dormant.registry";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const eventKey = (value: string): string => value.length <= 191 ? value : `sha256:${hash(value)}`;
const stored = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

// 휴면 등록부 세 명령을 exact 또는 한 줄 대상 형식으로 제한합니다.
export function parseAdminDormantRegistryCommand(message: string | undefined): AdminDormantRegistryCommand | null {
  if (message === "/휴면계정리스트") return { kind: "list" };
  if (message === "/휴면계정") return { kind: "usage", action: "register" };
  if (message === "/휴면해제") return { kind: "usage", action: "release" };
  if (message === undefined || /[\r\n]/.test(message)) return null;
  const matched = /^\/(휴면계정|휴면해제)[ \t]+(.+\S)[ \t]*$/.exec(message);
  if (matched === null) return null;
  return { kind: matched[1] === "휴면계정" ? "register" : "release", targetName: matched[2]!.trim() };
}

export function isAdminDormantRegistryCommand(message: string | undefined): boolean {
  return parseAdminDormantRegistryCommand(message) !== null;
}

export function normalizeAdminDormantRegistryDispatchMessage(message: string): string {
  const command = parseAdminDormantRegistryCommand(message);
  if (command === null || command.kind === "list") return command === null ? message : "/휴면계정리스트";
  return command.kind === "usage" ? `/${command.action === "register" ? "휴면계정" : "휴면해제"}`
    : `/${command.kind === "register" ? "휴면계정" : "휴면해제"}`;
}

// 날짜와 경과일을 stable 이름 순서로 휴면 목록에 표시합니다.
export function formatAdminDormantRegistryList(rows: RegistryRow[]): string {
  if (rows.length === 0) return "📋 휴면계정 목록\n\n등록된 휴면계정이 없습니다.";
  return `📋 휴면계정 목록\n\n${rows.map((row, index) => `${index + 1}. [${row.display_name}] ${row.started_date} (${row.elapsed_days.toString()}일 경과)`).join("\n")}`;
}

// 동일 이벤트의 일시적 lock 충돌만 제한적으로 재시도합니다.
async function withRegistryRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await work(); }
    catch (error) {
      last = error;
      const value = error as { code?: unknown; errno?: unknown };
      if (attempt === 2 || (value.code !== "ER_LOCK_DEADLOCK" && value.code !== "ER_LOCK_WAIT_TIMEOUT" && value.errno !== 1213 && value.errno !== 1205)) throw error;
    }
  }
  throw last;
}

// 등록·해제·목록을 versioned registry와 operation 원장에 원자 기록합니다.
export class AdminDormantAccountRegistryService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<{ status: "changed"; data: string; outboxId: string }> {
    const result = await this.execute({ ...input, destinationId: input.channelId });
    return { status: "changed", data: result.message, outboxId: result.outboxId };
  }

  async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminDormantRegistryResult> {
    const command = parseAdminDormantRegistryCommand(input.message);
    if (command === null) throw new ApplicationError("ADMIN_DORMANT_REGISTRY_INVALID", "휴면계정 명령 형식을 확인해 주세요.", 422);
    const operator = await resolveAccountDeleteOperator(this.database, input.externalUserId);
    if (operator === null) throw new ApplicationError("ADMIN_DORMANT_REGISTRY_FORBIDDEN", "휴면계정 관리 권한이 없습니다.", 403);
    const requestHash = hash(JSON.stringify(command));
    return withRegistryRetry(() => this.database.withTransaction(async (tx) => {
      const key = eventKey(input.eventId);
      const claim = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
        [randomUUID(), SCOPE, key, operator.operator_id]
      );
      const previous = (await tx.query<Array<{ result_json: string | AdminDormantRegistryResult | null; request_hash: string | null }>>(
        `SELECT operation.result_json,run_row.request_hash FROM operations operation
         LEFT JOIN dormant_account_registry_runs run_row ON run_row.operation_id=operation.id
         WHERE operation.id=? FOR UPDATE`, [claim.insertId]
      ))[0]!;
      if (previous.result_json !== null) {
        if (previous.request_hash !== requestHash) throw new ApplicationError("ADMIN_DORMANT_REGISTRY_EVENT_CONFLICT", "같은 이벤트의 휴면계정 요청 내용이 다릅니다.", 409);
        return { ...stored<AdminDormantRegistryResult>(previous.result_json), replayed: true };
      }

      let target: Target | null = null;
      if (command.kind === "register" || command.kind === "release") {
        const targets = await tx.query<Target[]>(
          `SELECT player.id player_id,profile.current_display_name display_name FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
           WHERE player.status='active' AND player.deleted_at IS NULL AND profile.current_display_name=?
           ORDER BY player.id LIMIT 2 FOR UPDATE`, [command.targetName]
        );
        if (targets.length === 0) throw new ApplicationError("ADMIN_DORMANT_REGISTRY_TARGET_MISSING", "대상 회원을 찾을 수 없습니다.", 404);
        if (targets.length > 1) throw new ApplicationError("ADMIN_DORMANT_REGISTRY_TARGET_AMBIGUOUS", "동일한 이름의 회원이 여러 명입니다.", 409);
        target = targets[0]!;
      }

      let changed = false;
      let resultCode: string = command.kind;
      let message: string;
      if (command.kind === "list") {
        const rows = await tx.query<RegistryRow[]>(
          `SELECT registry.player_id,profile.current_display_name display_name,
                  DATE_FORMAT(registry.started_at,'%Y-%m-%d') started_date,
                  TIMESTAMPDIFF(DAY,registry.started_at,UTC_TIMESTAMP(3)) elapsed_days
             FROM dormant_account_registry registry
             JOIN player_profiles profile ON profile.player_id=registry.player_id
            WHERE registry.status='active'
            ORDER BY profile.current_display_name COLLATE utf8mb4_unicode_ci,registry.player_id`
        );
        message = formatAdminDormantRegistryList(rows);
        resultCode = "listed";
      } else if (command.kind === "usage") {
        message = command.action === "register" ? "사용법: /휴면계정 [대상명]" : "사용법: /휴면해제 [대상명]";
        resultCode = "usage";
      } else {
        const current = (await tx.query<Array<{ status: string; started_at: string }>>(
          "SELECT status,started_at FROM dormant_account_registry WHERE player_id=? FOR UPDATE", [target!.player_id]
        ))[0];
        if (command.kind === "register") {
          changed = current?.status !== "active";
          if (changed) {
            await tx.execute(
              `INSERT INTO dormant_account_registry(player_id,status,started_at,ended_at,registered_by,released_by,version,created_at,updated_at)
               VALUES (?,'active',UTC_TIMESTAMP(3),NULL,?,NULL,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
               ON DUPLICATE KEY UPDATE status='active',started_at=UTC_TIMESTAMP(3),ended_at=NULL,registered_by=VALUES(registered_by),released_by=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3)`,
              [target!.player_id, operator.operator_id]
            );
            await tx.execute(
              "INSERT INTO dormant_account_registry_history(operation_id,player_id,action_code,previous_status,next_status,started_at_snapshot) VALUES (?,?,'register',?,'active',UTC_TIMESTAMP(3))",
              [claim.insertId, target!.player_id, current?.status ?? null]
            );
          }
          resultCode = changed ? "registered" : "already_registered";
          message = changed ? `✅ [${target!.display_name}] 님을 휴면계정으로 등록했습니다.` : `ℹ️ [${target!.display_name}] 님은 이미 휴면계정입니다.`;
        } else {
          changed = current?.status === "active";
          if (changed) {
            await tx.execute("UPDATE dormant_account_registry SET status='released',ended_at=UTC_TIMESTAMP(3),released_by=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND status='active'", [operator.operator_id, target!.player_id]);
            await tx.execute(
              "INSERT INTO dormant_account_registry_history(operation_id,player_id,action_code,previous_status,next_status,started_at_snapshot) VALUES (?,?,'release','active','released',?)",
              [claim.insertId, target!.player_id, current!.started_at]
            );
          }
          resultCode = changed ? "released" : "not_registered";
          message = changed ? `✅ [${target!.display_name}] 님의 휴면계정을 해제했습니다.` : `ℹ️ [${target!.display_name}] 님은 휴면계정이 아닙니다.`;
        }
      }

      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [claim.insertId,input.destinationId,JSON.stringify({ data: message })]);
      const result: AdminDormantRegistryResult = { message,outboxId:outbox.insertId.toString(),replayed:false,resultCode,targetPlayerId:target?.player_id.toString() ?? null,changed };
      const action = command.kind === "usage" ? "usage" : command.kind;
      await tx.execute("INSERT INTO dormant_account_registry_runs(operation_id,operator_id,action_code,target_player_id,request_hash,changed,result_json) VALUES (?,?,?,?,?,?,?)", [claim.insertId,operator.operator_id,action,target?.player_id ?? null,requestHash,changed,JSON.stringify(result)]);
      const commandCode = command.kind === "list" ? "ADMIN_DORMANT_REGISTRY_LIST" : command.kind === "release" || (command.kind === "usage" && command.action === "release") ? "ADMIN_DORMANT_REGISTRY_RELEASE" : "ADMIN_DORMANT_REGISTRY_REGISTER";
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [key,commandCode,claim.insertId,resultCode]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'account.dormant.registry',?,?,UTC_TIMESTAMP(3))", [claim.insertId,operator.operator_id,target?.player_id ?? null,resultCode,JSON.stringify({ action,changed,targetPlayerId:result.targetPlayerId })]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),claim.insertId]);
      return result;
    }));
  }
}
